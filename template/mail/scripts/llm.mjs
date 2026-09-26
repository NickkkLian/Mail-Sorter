// llm.mjs — one small, dependency-free way to call four kinds of LLM endpoint (Node 18+ fetch; no SDK).
// Providers: anthropic (default) · openai · gemini · openai-compatible (Ollama, LM Studio, vLLM, most gateways).
// Model-agnostic: the prompt asks for JSON in plain words and the caller validates the reply (extractJson). No
// provider-only feature is a precondition. Keys travel in headers only, never in a URL, and are never stored.
// Same contract as docs/llm.js and llm.py in Bill Bench (NickkkLian/bill-categoriser); template/check-llm.mjs tests it against a mock.

const PROVIDERS = ['anthropic', 'openai', 'gemini', 'openai-compatible'];
const LABEL = { anthropic: 'Claude (Anthropic)', openai: 'OpenAI', gemini: 'Google Gemini', 'openai-compatible': 'OpenAI-compatible endpoint' };
const DEFAULT_MODEL = { anthropic: 'claude-sonnet-5' };
// Output-token budget when the caller gives none. Claude Sonnet 5 thinks on every request and the thinking counts
// toward max_tokens, so Claude gets 16000; other providers keep 2048 (a small local model can reject a larger one).
const DEFAULT_MAX_TOKENS = { anthropic: 16000 };
const FALLBACK_MAX_TOKENS = 2048;
const DEFAULT_BASE = { anthropic: 'https://api.anthropic.com/v1', openai: 'https://api.openai.com/v1', gemini: 'https://generativelanguage.googleapis.com/v1beta' };

class ConfigError extends Error {}
class ProviderError extends Error {}

function config({ provider = 'anthropic', model = '', baseUrl = '', apiKey = '' } = {}) {
  provider = String(provider).trim().toLowerCase();
  if (!PROVIDERS.includes(provider)) throw new ConfigError(`provider "${provider}" is not one of ${PROVIDERS.join(', ')}`);
  model = String(model || DEFAULT_MODEL[provider] || '').trim();
  if (!model) throw new ConfigError(`a model id is required for ${LABEL[provider]} (use one from your provider's model list)`);
  baseUrl = String(baseUrl || DEFAULT_BASE[provider] || '').trim().replace(/\/+$/, '');
  if (!baseUrl) throw new ConfigError('a base URL is required for an OpenAI-compatible endpoint (for Ollama: http://localhost:11434/v1)');
  apiKey = String(apiKey || '').trim();
  if (!apiKey && provider !== 'openai-compatible') throw new ConfigError(`an API key is required for ${LABEL[provider]}`);
  return { provider, model, baseUrl, apiKey };
}

function buildRequest(cfg, system, user, maxTokens, { browser = false } = {}) {
  const { provider: p, model, baseUrl: base, apiKey: key } = cfg;
  if (maxTokens == null) maxTokens = DEFAULT_MAX_TOKENS[p] || FALLBACK_MAX_TOKENS;
  const headers = { 'content-type': 'application/json' };
  let url, body;
  if (p === 'anthropic') {
    url = `${base}/messages`;
    Object.assign(headers, { 'x-api-key': key, 'anthropic-version': '2023-06-01' });
    if (browser) headers['anthropic-dangerous-direct-browser-access'] = 'true';   // Anthropic requires it for calls from a page
    body = { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] };
  } else if (p === 'openai' || p === 'openai-compatible') {
    url = `${base}/chat/completions`;
    if (key) headers.authorization = `Bearer ${key}`;
    body = { model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
    // OpenAI deprecated max_tokens (reasoning models reject it); many compatible servers only know max_tokens.
    // Temperature stays at each model's default: several models reject any other value.
    body[p === 'openai' ? 'max_completion_tokens' : 'max_tokens'] = maxTokens;
  } else {
    const name = model.startsWith('models/') ? model.slice(7) : model;
    url = `${base}/models/${encodeURIComponent(name)}:generateContent`;
    headers['x-goog-api-key'] = key;
    body = { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { maxOutputTokens: maxTokens } };
  }
  return { url, headers, body: JSON.stringify(body) };
}

function parseResponse(cfg, data) {
  try {
    if (cfg.provider === 'anthropic') {
      // a refusal, or a reply cut off at max_tokens, is not an answer: say which, instead of parsing half of one
      if (data.stop_reason === 'refusal') throw new ProviderError('anthropic: the model declined the request (stop_reason refusal)');
      if (data.stop_reason === 'max_tokens') throw new ProviderError('anthropic: the reply was cut off at max_tokens (stop_reason max_tokens); ask for fewer items per call or raise max_tokens');
    }
    if (cfg.provider === 'anthropic') return { text: data.content.filter(c => (c.type || 'text') === 'text').map(c => c.text || '').join(''), model: data.model || cfg.model };
    if (cfg.provider === 'gemini') return { text: data.candidates[0].content.parts.map(x => x.text || '').join(''), model: data.modelVersion || cfg.model };
    return { text: data.choices[0].message.content || '', model: data.model || cfg.model };
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    throw new ProviderError(`${cfg.provider}: unexpected response shape (${e.message})`);
  }
}

async function complete(cfg, system, user, { maxTokens, fetchImpl, browser = false, timeoutMs = 60000 } = {}) {
  const req = buildRequest(cfg, system, user, maxTokens, { browser });
  const f = fetchImpl || fetch;
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  let res;
  try { res = await f(req.url, { method: 'POST', headers: req.headers, body: req.body, signal: ctl ? ctl.signal : undefined }); }
  catch (e) { throw new ProviderError(`${cfg.provider}: network error (${e.name === 'AbortError' ? 'timed out' : e.message}) — offline, blocked by CORS, or the endpoint is down`); }
  finally { if (timer) clearTimeout(timer); }
  const raw = await res.text();
  if (!res.ok) {
    let detail = raw.slice(0, 300);
    try { const j = JSON.parse(raw); detail = (j.error && (j.error.message || j.error)) || detail; } catch (e) {}
    throw new ProviderError(`${cfg.provider}: HTTP ${res.status} ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`.trim());
  }
  let data;
  try { data = JSON.parse(raw); } catch (e) { throw new ProviderError(`${cfg.provider}: response was not JSON`); }
  return parseResponse(cfg, data);
}

function extractJson(text, kind = 'array') {
  const [open, close] = kind === 'array' ? ['[', ']'] : ['{', '}'];
  const s = String(text).replace(/```(?:json)?/g, '');
  let start = s.indexOf(open);
  while (start !== -1) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === open) depth++;
      else if (ch === close && --depth === 0) {
        try { return JSON.parse(s.slice(start, i + 1)); } catch (e) { break; }
      }
    }
    start = s.indexOf(open, start + 1);
  }
  throw new Error(`no JSON ${kind} in the model reply`);
}

function describe(cfg) {
  return `${LABEL[cfg.provider]} · ${cfg.model}${cfg.baseUrl === DEFAULT_BASE[cfg.provider] ? '' : ' @ ' + cfg.baseUrl}`;
}

/** Configuration from environment variables: LLM_PROVIDER, LLM_MODEL (or the older MODEL), LLM_BASE_URL and the key
 *  the provider needs — ANTHROPIC_API_KEY | OPENAI_API_KEY | GEMINI_API_KEY | LLM_API_KEY (OpenAI-compatible). */
const KEY_ENV = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY', 'openai-compatible': 'LLM_API_KEY' };
function configFromEnv(env, { defaultModel } = {}) {
  const provider = String(env.LLM_PROVIDER || 'anthropic').trim().toLowerCase();
  if (!PROVIDERS.includes(provider)) throw new ConfigError(`LLM_PROVIDER="${provider}" is not one of ${PROVIDERS.join(', ')}`);
  const model = env.LLM_MODEL || env.MODEL || (provider === 'anthropic' ? (defaultModel || DEFAULT_MODEL.anthropic) : '');
  if (!model) throw new ConfigError(`LLM_MODEL is required for ${provider}`);
  if (provider === 'openai-compatible' && !env.LLM_BASE_URL) throw new ConfigError('LLM_BASE_URL is required for openai-compatible (for Ollama: http://localhost:11434/v1)');
  if (provider !== 'openai-compatible' && !env[KEY_ENV[provider]]) throw new ConfigError(`${KEY_ENV[provider]} is not set`);
  return config({ provider, model, baseUrl: env.LLM_BASE_URL || '', apiKey: env[KEY_ENV[provider]] || '' });
}

export { PROVIDERS, LABEL, DEFAULT_MODEL, DEFAULT_BASE, ConfigError, ProviderError, config, buildRequest, parseResponse, complete, extractJson, describe, KEY_ENV, configFromEnv };
