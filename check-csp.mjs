// The page's Content-Security-Policy, kept in step with the page. There is no build step, so this script both writes the
// policy and checks it.
//
//   node check-csp.mjs --write      put the policy in index.html (or bring its hashes up to date after an edit)
//   node check-csp.mjs              check; exits 1 on any finding (CI runs this)
//   node check-csp.mjs --self-test  the check must catch each broken copy of the page below, and pass the real page
//
// The policy: scripts only from this site's own files ('self') and from the page's own inline scripts, each pinned by
// its sha256. No 'unsafe-inline', no 'unsafe-eval', no other host. So the browser itself refuses a script from another
// host, text run as code (eval, a string given to setTimeout, a script element given text) and inline event-handler
// attributes. The key and token this app keeps in localStorage share an origin with other sites; this keeps a script
// that got into shown content from running.
//
// What the check fails on:
//   1. not exactly one policy <meta>, or one that comes after a <script> (that script runs without it);
//   2. a policy that is not exactly  script-src 'self'  followed by sha256 hashes;
//   3. hashes that are not those of the page's inline scripts, in order (an edited inline script would stop running);
//   4. an inline event-handler attribute (onclick="...") or a javascript: address in the page or in its scripts, which
//      the policy would refuse to run.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PAGE = 'index.html';
// every file whose text ends up in the page: the page itself and the scripts it loads from this repository
const scriptFiles = (page) => [...page.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]).filter((p) => existsSync(join(ROOT, p)));

export const CSP_META = /<meta\s+http-equiv\s*=\s*["']?Content-Security-Policy["']?\s+content\s*=\s*"([^"]*)"\s*\/?>\n?/gi;
const INLINE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const HANDLER = /\son[a-z]+\s*=\s*["']|\b(?:href|src|action)\s*=\s*["']\s*javascript:/gi;

export function inlineHashes(page) {
  return [...page.matchAll(INLINE)].filter((m) => !/\bsrc\s*=/.test(m[1]))
    .map((m) => `'sha256-${createHash('sha256').update(m[2], 'utf8').digest('base64')}'`);
}
export const policyFor = (page) => `script-src 'self' ${inlineHashes(page).join(' ')}`;

export function check(page, files = {}) {
  const found = [];
  const metas = [...page.matchAll(CSP_META)];
  if (metas.length !== 1) return [`${PAGE}: needs exactly one Content-Security-Policy <meta> (found ${metas.length})`];
  const m = metas[0], first = page.search(/<script\b/i);
  if (first !== -1 && m.index > first) found.push(`${PAGE}: the Content-Security-Policy comes after a <script>, which runs without it`);
  const t = m[1].trim().split(/\s+/);
  if (t[0] !== 'script-src' || t[1] !== "'self'" || t.length < 3 || !t.slice(2).every((x) => /^'sha256-[A-Za-z0-9+/]{43}='$/.test(x))) {
    found.push(`${PAGE}: the Content-Security-Policy is not exactly script-src 'self' plus sha256 hashes: ${m[1]}`);
  } else {
    const want = inlineHashes(page).join(' '), have = t.slice(2).join(' ');
    if (want !== have) found.push(`${PAGE}: the policy's hashes are not those of the page's inline scripts (run node check-csp.mjs --write)`);
  }
  for (const [name, text] of Object.entries({ [PAGE]: page, ...files })) {
    for (const h of text.matchAll(HANDLER)) {
      const line = text.slice(0, h.index).split('\n').length;
      found.push(`${name}:${line}: an inline event handler or javascript: address, which the policy does not run: ${text.slice(h.index, h.index + 60).trim()}`);
    }
  }
  return found;
}

const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const readFiles = (page) => Object.fromEntries(scriptFiles(page).map((p) => [p, read(p)]));

// Broken copies of the real page; the check must catch each one
const ADD = (src) => (p) => p.replace("script-src 'self' ", `script-src 'self' ${src} `);
export const BROKEN = [
  ['no policy', (p) => p.replace(CSP_META, '')],
  ["'unsafe-eval' added", ADD("'unsafe-eval'")],
  ["'unsafe-inline' added", ADD("'unsafe-inline'")],
  ['another host added', ADD('https://cdn.example.com')],
  ['any https host', ADD('https:')],
  ['a wildcard', ADD('*')],
  ['another directive added', (p) => p.replace(/(content="script-src[^"]*)"/, '$1; object-src *"')],
  ["'self' taken out", (p) => p.replace("script-src 'self' ", 'script-src ')],
  ['no hash left', (p) => p.replace(/(content="script-src 'self')[^"]*"/, '$1"')],
  ['a hash for another script', (p) => p.replace(/'sha256-[^']{44}'/, `'sha256-${'A'.repeat(43)}='`)],
  ['an inline script edited', (p) => p.replace(/<script>/, '<script>/* edited */')],
  ['an inline script added', (p) => p.replace('</body>', '<script>void 0</script>\n</body>')],
  ['the policy moved after the first script', (p) => { const m = p.match(CSP_META)[0]; return p.replace(m, '').replace('</head>', `${m}</head>`); }],
  ['two policies', (p) => p.replace(CSP_META, (m) => `${m}${m}`)],
  ['an inline click handler', (p) => p.replace('</body>', '<button onclick="go()">x</button>\n</body>')],
  ['a javascript: link', (p) => p.replace('</body>', '<a href="javascript:go()">x</a>\n</body>')],
];

function selfTest() {
  const page = read(PAGE), files = readFiles(page);
  let ok = true;
  const own = check(page, files);
  console.log(own.length ? `REAL PAGE FAILS: ${own.join('; ')}` : `real page passes: ${policyFor(page).split(' ').length - 2} inline script hashes, ${Object.keys(files).length} script files scanned`);
  if (own.length) ok = false;
  for (const [name, change] of BROKEN) {
    const changed = change(page);
    const n = changed === page ? 0 : Math.max(0, check(changed, files).length - own.length);
    console.log(`${n ? 'caught ' : 'MISSED '} ${name}${changed === page ? ' (the change did not apply)' : ''}`);
    if (!n) ok = false;
  }
  console.log(ok ? `SELF-TEST PASS: the real page passes and ${BROKEN.length} broken copies are caught` : 'SELF-TEST FAIL');
  return ok;
}

if (process.argv.includes('--self-test')) process.exit(selfTest() ? 0 : 1);
if (process.argv.includes('--write')) {
  const page = read(PAGE), metas = [...page.matchAll(CSP_META)];
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policyFor(page.replace(CSP_META, ''))}">\n`;
  let out;
  if (metas.length === 1) out = page.replace(CSP_META, meta);
  else if (metas.length === 0) {
    const cs = page.match(/<meta charset="[^"]*">\n/i);
    if (!cs) { console.error(`${PAGE} needs a <meta charset> line to put the policy after`); process.exit(2); }
    out = page.replace(cs[0], cs[0] + meta);
  } else { console.error(`${PAGE} has ${metas.length} policies; leave one`); process.exit(2); }
  writeFileSync(join(ROOT, PAGE), out);
  console.log(`wrote ${meta.trim()}`);
}
const page = read(PAGE), found = check(page, readFiles(page));
for (const f of found) console.log(f);
if (found.length) { console.log(`Content-Security-Policy check failed (${found.length} findings)`); process.exit(1); }
console.log(`Content-Security-Policy ok: ${policyFor(page)}`);
