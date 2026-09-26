// check-llm.mjs — the model path of the template against a local mock of each provider's documented API (Node 18+).
// No keys, no network beyond 127.0.0.1. Proves request shape, reply parsing, configuration errors, and the wiring from
// sortMail → modelClassifier → provider → labels. Does not prove a live service accepts the call (see the README table).
import http from 'node:http';
import * as L from './mail/scripts/llm.mjs';
import { sortMail, modelClassifier } from './mail/scripts/classify.mjs';

let seen = [], script = [];
const srv = http.createServer((req, res) => {
  let raw = '';
  req.on('data', c => (raw += c));
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : {};
    seen.push({ path: req.url, headers: req.headers, body });
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.url.startsWith('/fail')) return send(401, { error: { message: 'invalid key' } });
    const user = req.url.endsWith('/messages') ? body.messages[0].content : req.url.endsWith('/chat/completions') ? body.messages.find(m => m.role === 'user').content : body.contents[0].parts[0].text;
    const items = JSON.parse(user);
    const text = script.length ? script.shift() : 'Sorted:\n```json\n' + JSON.stringify(items.map(it => ({ category: /invoice|statement/i.test(it.subject) ? 'finance' : 'work', action: false, reason: 'mock' }))) + '\n```';
    if (req.url.endsWith('/messages')) return send(200, { model: 'claude-mock', content: [{ type: 'text', text }] });
    if (req.url.endsWith('/chat/completions')) return send(200, { model: 'openai-mock', choices: [{ message: { content: text } }] });
    return send(200, { modelVersion: 'gemini-mock', candidates: [{ content: { parts: [{ text }] } }] });
  });
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('PASS  ' + msg); } else { fail++; console.log('FAIL  ' + msg); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const mails = Array.from({ length: 6 }, (_, i) => ({ uid: 500 + i, msgid: `<m${i}@mail.example>`, from: `s${i}@corp.example`, subject: i % 2 ? 'Invoice due Friday' : 'Design review Thursday', date: new Date(Date.UTC(2026, 8, 1, 9, i)).toISOString(), body: 'SECRET BODY' }));
const config = { enabled: true, categories: [{ key: 'finance', label: 'Finance' }, { key: 'work', label: 'Work' }], archive_categories: [], keep_items: 50, primary_only: false };
function run(cfg) {
  const labels = [];
  return sortMail({ config, digest: { items: [] }, fetchHeaders: async () => mails.map(m => ({ ...m })), labelMessage: async (uid, label) => labels.push([uid, label]), moveMessage: async () => { throw new Error('no move expected'); }, classify: modelClassifier(cfg) })
    .then(r => ({ r, labels }));
}

const PROVIDERS = [
  ['anthropic', { ANTHROPIC_API_KEY: 'sk-ant-test' }, '/messages', 'claude-sonnet-5'],
  ['openai', { OPENAI_API_KEY: 'sk-oa-test', LLM_MODEL: 'some-openai-model' }, '/chat/completions', 'some-openai-model'],
  ['gemini', { GEMINI_API_KEY: 'AIza-test', LLM_MODEL: 'gemini-some-model' }, '/models/gemini-some-model:generateContent', 'gemini-some-model'],
  ['openai-compatible', { LLM_MODEL: 'llama-local' }, '/chat/completions', 'llama-local'],
];
for (const [provider, env, path, model] of PROVIDERS) {
  seen = [];
  const cfg = L.configFromEnv({ LLM_PROVIDER: provider, LLM_BASE_URL: base, ...env });   // no defaultModel: what classify.mjs does
  const { r, labels } = await run(cfg);
  ok(seen.length === 1 && seen[0].path === path, `${provider}: one batched call to ${path}`);
  const sent = JSON.stringify(seen[0].body);
  ok(!sent.includes('SECRET BODY') && !sent.includes('uid') && sent.includes('Design review Thursday'), `${provider}: the request carries sender + subject only`);
  ok(seen[0].body.model === model || (provider === 'gemini' && seen[0].path.includes(model)), `${provider}: model ${model}`);
  if (provider === 'anthropic') ok(seen[0].body.max_tokens >= 16000, `anthropic: max_tokens ${seen[0].body.max_tokens} >= 16000 (Sonnet 5's thinking counts toward it)`);
  ok(labels.length === 6 && labels.filter(([, l]) => l === 'AI/Finance').length === 3 && labels.filter(([, l]) => l === 'AI/Work').length === 3, `${provider}: verdicts become AI/ labels (3 finance, 3 work)`);
  ok(r.digest.items.length === 6, `${provider}: digest holds the 6 classified items`);
}

// headers per provider (keys in headers, never in the URL)
for (const p of L.PROVIDERS) {
  const cfg = L.config({ provider: p, model: 'm', baseUrl: 'http://h/v1', apiKey: 'SECRET-' + p });
  const req = L.buildRequest(cfg, 's', 'u', 10);
  ok(!req.url.includes('SECRET') && JSON.stringify(req.headers).includes('SECRET-' + p), `${p}: key only in headers, never in the URL`);
}
{ const req = L.buildRequest(L.config({ provider: 'openai', model: 'm', apiKey: 'k' }), 's', 'u', 99);
  const b = JSON.parse(req.body); ok(b.max_completion_tokens === 99 && !('max_tokens' in b) && !('temperature' in b), 'openai: max_completion_tokens, no temperature'); }
{ const req = L.buildRequest(L.config({ provider: 'anthropic', apiKey: 'k' }), 's', 'u', 10);
  ok(!('anthropic-dangerous-direct-browser-access' in req.headers), 'anthropic from Node: no browser-access header'); }

// a reply that is not JSON: every item falls back to "other", nothing crashes
{ script = ['I would rather not.']; seen = [];
  const cfg = L.configFromEnv({ LLM_PROVIDER: 'openai-compatible', LLM_BASE_URL: base, LLM_MODEL: 'm' });
  const { labels } = await run(cfg);
  ok(labels.length === 6 && labels.every(([, l]) => l === 'AI/other'), 'unparseable reply → every item labelled AI/other'); }

// HTTP error surfaces with the provider message
{ let msg = ''; try { await L.complete(L.config({ provider: 'anthropic', baseUrl: base + '/fail', apiKey: 'bad' }), 's', 'u'); } catch (e) { msg = e.message; }
  ok(/HTTP 401 invalid key/.test(msg), 'HTTP error names status and provider message'); }

// configuration errors name what to set; the older MODEL variable still works
for (const [env, re] of [[{}, /ANTHROPIC_API_KEY is not set/], [{ LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'k' }, /LLM_MODEL is required for openai/], [{ LLM_PROVIDER: 'openai-compatible', LLM_MODEL: 'm' }, /LLM_BASE_URL is required/], [{ LLM_PROVIDER: 'mistral' }, /not one of/]]) {
  let msg = ''; try { L.configFromEnv(env); } catch (e) { msg = e.message; }
  ok(re.test(msg), `config error: ${JSON.stringify(env)} → ${msg}`);
}
ok(L.configFromEnv({ ANTHROPIC_API_KEY: 'k', MODEL: 'older-name' }).model === 'older-name', 'the older MODEL variable is still honoured');
ok(L.configFromEnv({ ANTHROPIC_API_KEY: 'k' }).model === 'claude-sonnet-5', 'Claude defaults to claude-sonnet-5');
// the only Claude models the scripts may name are Opus 5.5 and Sonnet 5; eval/llm-cache.json is a record of an older run
{ const fs = await import('node:fs'), url = await import('node:url');
  const root = url.fileURLToPath(new URL('..', import.meta.url));
  const files = ['template/mail/scripts/llm.mjs', 'template/mail/scripts/classify.mjs', 'template/.github/workflows/mail-sync.yml', 'template/SECRETS.md', 'eval/score.mjs'];
  const ids = files.flatMap(f => [...fs.readFileSync(root + f, 'utf8').matchAll(/claude-[a-z0-9-]+/g)].map(m => f + ': ' + m[0]));
  const bad = ids.filter(s => !/: claude-(opus-5-5|sonnet-5)$/.test(s));
  ok(ids.length > 0 && bad.length === 0, `scripts name Opus 5.5 / Sonnet 5 only (${ids.length} ids seen${bad.length ? '; not allowed: ' + bad.join(', ') : ''})`); }

// (2026-09-25) Claude's output budget, and its stop reasons, with fetch replaced by a fake: nothing leaves this process
{
  const fakeFetch = (reply) => { const sent = []; const f = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, status: 200, text: async () => JSON.stringify(reply) }; }; f.sent = sent; return f; };
  const claude = L.config({ provider: 'anthropic', apiKey: 'k', baseUrl: 'http://fake.invalid/v1' });
  let f = fakeFetch({ model: 'claude-sonnet-5', stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '[1]' }] });
  const r = await L.complete(claude, 'S', 'U', { fetchImpl: f });
  ok(f.sent[0].model === 'claude-sonnet-5' && f.sent[0].max_tokens === 16000, 'anthropic: default model claude-sonnet-5 with max_tokens 16000 (Sonnet 5 thinking counts toward it)');
  ok(r.text === '[1]', 'anthropic: the text is read by block type after a thinking block');
  f = fakeFetch({ model: 'm', choices: [{ message: { content: '[]' } }] });
  await L.complete(L.config({ provider: 'openai-compatible', model: 'llama-local', baseUrl: 'http://fake.invalid/v1' }), 'S', 'U', { fetchImpl: f });
  ok(f.sent[0].max_tokens === 2048, 'openai-compatible: the default budget stays 2048');
  for (const [stop, re] of [['refusal', /declined the request \(stop_reason refusal\)/], ['max_tokens', /cut off at max_tokens/]]) {
    f = fakeFetch({ model: 'claude-sonnet-5', stop_reason: stop, content: [{ type: 'text', text: '[{"a":' }] });
    let msg = ''; try { await L.complete(claude, 'S', 'U', { fetchImpl: f }); } catch (e) { msg = e.message; }
    ok(re.test(msg), `anthropic: stop_reason ${stop} is an error that says so (${msg || 'no error'})`);
  }
}

srv.close();
console.log(fail ? `RESULT: ${fail} FAILED (${pass} passed)` : `RESULT: ALL PASS (${pass})`);
process.exit(fail ? 1 : 0);
