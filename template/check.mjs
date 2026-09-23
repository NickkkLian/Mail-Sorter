// check.mjs — runs the classifier core on 20 synthetic emails with mock adapters and no credentials.
// Proves the four safety constraints mechanically: the model only ever sees sender + subject; the mailbox is only ever
// asked to add a label (and to move mail only for categories you explicitly list); `enabled: false` does nothing;
// the digest is capped at keep_items. Exit 0 = all hold; 1 = a constraint broke. Also a DRY_RUN smoke of the CLI.
import { sortMail, parseVerdicts, buildPrompt } from './mail/scripts/classify.mjs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push([ok ? 'PASS' : 'FAIL', name, detail]); if (!ok) failed++; };
const config = JSON.parse(JSON.stringify(await import('node:fs').then(fs => JSON.parse(fs.readFileSync(new URL('./mail/config.json', import.meta.url), 'utf8')))));
const CATS = config.categories.map(c => c.key);
const KW = [[/invoice|statement|tax|bank/i, 'finance'], [/meeting|review|deadline|report/i, 'work'], [/flight|hotel|boarding/i, 'travel'], [/shipped|tracking|delivery/i, 'logistics'], [/sign-in|password|security|account/i, 'account'], [/off|sale|deal|%/i, 'promo'], [/digest|newsletter|papers/i, 'reading'], [/viewing|dentist|library|landlord/i, 'life']];
const mails = Array.from({ length: 20 }, (_, i) => {
  const subjects = ['Invoice 4471 is due Friday', 'Design review — Thu 14:00', 'Your flight is now boarding at gate C4', 'Your package has shipped', 'Security alert: new sign-in', '70% off everything', 'Weekly digest: 12 new papers', 'Re: apartment viewing on Saturday', 'Monthly statement ready', 'Q3 report draft attached'];
  const s = subjects[i % subjects.length];
  return { uid: 1000 + i, msgid: `<synthetic-${i}@mail.example>`, from: `sender${i}@corp.example`, subject: s + (i >= 10 ? ' (2)' : ''), date: new Date(Date.UTC(2026, 8, 1 + (i % 7), 9, i)).toISOString(), body: `SECRET BODY ${i} — must never reach the model` };
});

// mock adapters that record everything they are asked to do
function mocks() {
  const calls = { label: [], move: [], other: [], classifyInputs: [] };
  const mailbox = new Proxy({}, { get: (_, verb) => (...a) => { calls.other.push(String(verb)); throw new Error('forbidden mailbox verb: ' + String(verb)); } });
  return {
    calls, mailbox,
    fetchHeaders: async () => mails,
    labelMessage: async (uid, label) => { calls.label.push([uid, label]); },
    moveMessage: async (uid, folder) => { calls.move.push([uid, folder]); },
    classify: async (batch, cats) => { calls.classifyInputs.push(...batch); return batch.map((b, j) => { const hit = KW.find(([rx]) => rx.test(b.subject)); return { category: j === 0 ? 'nonsense-category' : (hit ? hit[1] : 'nonsense-category'), action: /due|review|viewing/i.test(b.subject), reason: 'keyword', reason_en: 'keyword (en)' }; }); }, // first of every batch: a category the model is not allowed to invent
  };
}

// 1. normal run
{ const m = mocks(); const r = await sortMail({ config, digest: { items: [] }, ...m, now: new Date('2026-09-08T00:00:00Z') });
  check('model input carries only from + subject (no body, no uid, no date)', m.calls.classifyInputs.length === 20 && m.calls.classifyInputs.every(x => Object.keys(x).sort().join() === 'from,subject'), JSON.stringify(Object.keys(m.calls.classifyInputs[0] || {})));
  check('no synthetic body text reached the model', !JSON.stringify(m.calls.classifyInputs).includes('SECRET BODY'));
  check('every email got exactly one AI/ label and nothing else was done to the mailbox', m.calls.label.length === 20 && m.calls.label.every(([, l]) => l.startsWith('AI/')) && m.calls.move.length === 0 && m.calls.other.length === 0);
  check('a category outside config falls back to "other" instead of inventing a label', r.digest.items.some(i => i.category === 'other') && !r.digest.items.some(i => i.category === 'nonsense-category'));
  check('digest fields the board reads are present', ['updated_at', 'keep_items', 'total_classified', 'total_is_floor', 'items'].every(k => k in r.digest) && r.digest.items.every(i => ['subject', 'from', 'date', 'category', 'action', 'reason', 'msgid'].every(k => k in i)));
  check('digest items carry no body field', r.digest.items.every(i => !('body' in i)));
  // the board shows reason_en in English mode; a classifier that drops it would put every row back in the mailbox's language
  check('the English reason the model wrote is kept next to the original', r.digest.items.every(i => i.reason_en === 'keyword (en)' && i.reason === 'keyword'));
  check('the prompt asks for reason_en, so a real model is told to write one', buildPrompt([{ from: 'a@x.example', subject: 's' }], ['work']).system.includes('reason_en'));
}
// 2. enabled:false does nothing at all
{ const m = mocks(); const r = await sortMail({ config: { ...config, enabled: false }, digest: { items: [] }, ...m });
  check('enabled:false → nothing fetched, nothing labelled, digest untouched', r.skipped && m.calls.label.length === 0 && m.calls.classifyInputs.length === 0 && r.digest.items.length === 0); }
// 3. keep_items cap
{ const m = mocks(); const r = await sortMail({ config: { ...config, keep_items: 15 }, digest: { items: [] }, ...m });
  check('keep_items caps the digest window (20 in → 15 kept, newest first)', r.digest.items.length === 15 && r.digest.items[0].date >= r.digest.items[14].date && r.digest.total_classified === 20); }
// 4. archive only for explicitly listed categories
{ const m = mocks(); const r = await sortMail({ config: { ...config, archive_categories: ['promo'] }, digest: { items: [] }, ...m });
  check('move happens only for categories listed in archive_categories', m.calls.move.length > 0 && m.calls.move.length === r.digest.items.filter(i => i.category === 'promo').length); }
// 5. re-runs do not double count
{ const m = mocks(); const first = await sortMail({ config, digest: { items: [] }, ...m }); const m2 = mocks(); const second = await sortMail({ config, digest: first.digest, ...m2 });
  check('re-running over the same uids classifies nothing new and keeps the total', second.newItems === 0 && second.digest.total_classified === first.digest.total_classified && m2.calls.label.length === 0); }
// 6. prompt + parser
{ const p = buildPrompt([{ from: 'a@x.example', subject: 's' }], CATS); check('prompt tells the model it sees the envelope only and lists the allowed categories', /envelope only/.test(p.system) && CATS.every(c => p.system.includes(c)));
  check('parser tolerates prose around the JSON and pads short replies', parseVerdicts('sure: [{"category":"work"}]', 2).length === 2 && parseVerdicts('garbage', 3).every(v => Object.keys(v).length === 0)); }
// 7. CLI dry-run smoke: no credentials → exit 0, nothing connected
{ const r = spawnSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'mail/scripts/classify.mjs')], { cwd: path.dirname(fileURLToPath(import.meta.url)), env: { PATH: process.env.PATH, DRY_RUN: '1' }, encoding: 'utf8' });
  check('DRY_RUN=1 / no credentials: the CLI exits 0 without connecting', r.status === 0 && /DRY_RUN=1: not connecting/.test(r.stdout), (r.stdout + r.stderr).trim()); }
// 7b. the CLI reads the switch before it logs in: enabled:false exits 0 with credentials present and no connection attempted.
// A preloaded hook makes any socket or TLS connection print NETWORK ATTEMPT and exit 3. Negative control: the same run with
// enabled:true goes past the switch (it then fails to load or reach the mail server, which is the point).
{ const fs = await import('node:fs'); const os = await import('node:os');
  const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), 'mail/scripts/classify.mjs');
  const hook = 'data:text/javascript,' + encodeURIComponent("import net from 'node:net'; import tls from 'node:tls'; const stop = () => { console.log('NETWORK ATTEMPT'); process.exit(3); }; net.connect = net.createConnection = stop; tls.connect = stop;");
  const run = enabled => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'headersort-check-')); fs.mkdirSync(path.join(dir, 'mail'));
    fs.writeFileSync(path.join(dir, 'mail/config.json'), JSON.stringify({ ...config, enabled }));
    const r = spawnSync(process.execPath, ['--import', hook, cli], { cwd: dir, encoding: 'utf8', timeout: 20000,
      env: { PATH: process.env.PATH, GMAIL_USER: 'check@mail.example', GMAIL_APP_PASSWORD: 'not-a-password', ANTHROPIC_API_KEY: 'not-a-key' } });
    fs.rmSync(dir, { recursive: true, force: true }); return r; };
  const off = run(false), on = run(true);
  check('enabled:false: the CLI exits 0 before logging in, with credentials present', off.status === 0 && /skipped: disabled/.test(off.stdout) && !/NETWORK ATTEMPT/.test(off.stdout), (off.stdout + off.stderr).trim().slice(0, 160));
  check('negative control: with enabled:true the same run goes on towards the mail server', on.status !== 0 && !/skipped: disabled/.test(on.stdout), `exit ${on.status} · ` + (on.stdout + on.stderr).trim().split('\n').slice(-1)[0].slice(0, 120)); }
// 8. negative control: a core that leaks the body must be caught by check 2
{ const m = mocks(); const leakyClassify = async (batch) => { m.calls.classifyInputs.push(...batch.map(b => ({ ...b, body: 'SECRET BODY leaked' }))); return batch.map(() => ({ category: 'work' })); };
  await sortMail({ config, digest: { items: [] }, ...m, classify: leakyClassify });
  check('negative control: a leaking adapter is detected by the body check', JSON.stringify(m.calls.classifyInputs).includes('SECRET BODY')); }

console.log(`headersort template check · ${new Date().toISOString()} · node ${process.version}`);
for (const [st, name, d] of results) console.log(`${st}  ${name}${d ? '  · ' + d : ''}`);
console.log(failed ? `RESULT: ${failed} FAILED` : 'RESULT: ALL PASS');
process.exit(failed ? 1 : 0);
