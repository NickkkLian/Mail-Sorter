// score.mjs — scores cached model output on eval/headers.json (40 synthetic sender+subject pairs → category).
//   node eval/score.mjs          score the cache; NOT RUN (exit 2) until eval/llm-cache.json exists
// Live cache generation is retired; the fixture describes the earlier category system.
//   node eval/score.mjs --break  negative control: a cached category outside the set must be refused
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Historical cache scoring only; current runtime is evaluated by score-cleanup.mjs.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(fs.readFileSync(path.join(HERE, 'headers.json'), 'utf8')), CACHE = path.join(HERE, 'llm-cache.json');
const load = p => { const c = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : { model: null, generated: null, entries: {} }; for (const [k, v] of Object.entries(c.entries || {})) if (!spec.categories.includes(v) && v !== 'other') throw new Error(`llm-cache: category ${JSON.stringify(v)} for ${k} is outside the allowed set`); if (Object.keys(c.entries || {}).length && !(c.model && c.generated && c.provider)) throw new Error('llm-cache: provider, model and generated date required'); return c; };
const KW = [[/invoice|statement|tax|payslip|payment|declined|bank/i, 'finance'], [/review|objectives|build|sprint|contract|redline/i, 'work'], [/flight|booking|ticket|rental|embassy|boarding/i, 'travel'], [/shipped|delivery|dispatched|return label|parcel/i, 'logistics'], [/sign-in|verification|password|storage|terms/i, 'account'], [/off|sale|arrivals|coupon|save/i, 'promo'], [/digest|issue #|long reads|posts|new post/i, 'reading'], [/viewing|appointment|overdue|membership|conference/i, 'life']];
const baseline = spec.items.filter(i => (KW.find(([rx]) => rx.test(i.subject)) || [])[1] === i.expected).length;
const arg = process.argv[2];
if (arg === '--break') { try { fs.mkdirSync(path.join(HERE, '.tmp'), { recursive: true }); const bad = path.join(HERE, '.tmp', 'llm-cache.json'); fs.writeFileSync(bad, JSON.stringify({ provider: 'anthropic', model: 'mutated', generated: '2026-01-01', entries: { h01: 'gossip' } })); console.log('MUTATION wrote a cache whose h01 category is "gossip" (outside the set) into a temporary copy'); load(bad); console.log('FAIL: mutated cache accepted'); process.exit(1); } catch (e) { console.log('EXPECTED FAILURE OBSERVED: ' + e.message); fs.rmSync(path.join(HERE, '.tmp'), { recursive: true, force: true }); process.exit(0); } }
let cache; try { cache = load(CACHE); } catch (e) { console.log('FAIL: ' + e.message); process.exit(2); }
if (arg === '--llm') { console.log('Historical fixture: live generation retired. Use score-cleanup.mjs for current rules.'); process.exit(2); }
console.log(`keyword baseline: ${baseline}/${spec.items.length} = ${Math.round(baseline / spec.items.length * 100)}%`);
const covered = spec.items.filter(i => i.id in cache.entries).length;
if (covered < spec.items.length) { console.log(`NOT RUN: cached model output covers ${covered}/${spec.items.length} items. Populate with: ANTHROPIC_API_KEY=... node eval/score.mjs --llm (or LLM_PROVIDER=openai|gemini|openai-compatible, LLM_MODEL and that provider's key)`); process.exit(2); }
const hits = spec.items.filter(i => cache.entries[i.id] === i.expected); const acc = hits.length / spec.items.length;
console.log(`model ${cache.provider} · ${cache.model} (${cache.generated}): ${hits.length}/${spec.items.length} = ${Math.round(acc * 100)}%`);
for (const i of spec.items) if (cache.entries[i.id] !== i.expected) console.log(`  miss ${i.id}: expected ${i.expected}, got ${cache.entries[i.id]} · ${i.subject}`);
console.log((acc >= spec.pass_threshold ? 'EVAL PASS' : 'EVAL FAIL') + ` (threshold ${Math.round(spec.pass_threshold * 100)}%)`); process.exit(acc >= spec.pass_threshold ? 0 : 1);
