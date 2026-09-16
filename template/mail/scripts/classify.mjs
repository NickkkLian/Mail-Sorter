// classify.mjs — the scheduled classifier, written against the board's contract. Copy this folder into your private
// data repo. It reads ONLY the envelope of new mail (sender + subject), asks the model for a category, ADDS a label,
// and writes a capped digest to mail/mail.json. It never reads bodies, never deletes, never marks read, never moves
// mail unless a category is listed in config.archive_categories.
//
// Pure core (sortMail) + thin adapters, so `node template/check.mjs` can run the whole thing with mocks and no credentials.
import fs from 'node:fs';
import path from 'node:path';
import { complete, configFromEnv, describe, extractJson } from './llm.mjs';

export const LABEL_PREFIX = 'AI/';

/** Decide what the run will do. Everything that touches a mailbox goes through the adapters passed in. */
export async function sortMail({ config, digest, fetchHeaders, labelMessage, moveMessage, classify, now = new Date(), backfillDays = 0, log = () => {} }) {
  const out = { skipped: null, fetched: 0, labelled: 0, archived: 0, newItems: 0 };
  if (config.enabled === false) { out.skipped = 'disabled in mail/config.json'; log('skipped: ' + out.skipped); return { digest, ...out }; }
  const categories = (config.categories || []).map(c => c.key);
  if (!categories.length) throw new Error('config.categories is empty');
  const keep = Number(config.keep_items || 500);
  const since = backfillDays > 0 ? new Date(now.getTime() - backfillDays * 864e5) : null;
  const headers = await fetchHeaders({ sinceUid: since ? null : digest.lastUid || null, since, primaryOnly: config.primary_only !== false });
  out.fetched = headers.length;
  const known = new Set((digest.items || []).map(i => i.uid));
  const fresh = headers.filter(h => !known.has(h.uid));
  const items = [];
  for (let i = 0; i < fresh.length; i += 25) {
    const batch = fresh.slice(i, i + 25).map(h => ({ from: h.from, subject: h.subject })); // the ONLY fields the model sees
    const verdicts = await classify(batch, categories);
    fresh.slice(i, i + 25).forEach((h, j) => {
      const v = verdicts[j] || {};
      const category = categories.includes(v.category) ? v.category : 'other';
      items.push({ uid: h.uid, msgid: h.msgid || null, subject: h.subject, from: h.from, date: h.date, category, action: v.action === true, reason: String(v.reason || '').slice(0, 120) });
    });
  }
  for (const it of items) {
    const label = LABEL_PREFIX + (config.categories.find(c => c.key === it.category)?.label || it.category);
    await labelMessage(it.uid, label); out.labelled++;
    if ((config.archive_categories || []).includes(it.category)) { await moveMessage(it.uid, config.archive_folder || '[Gmail]/All Mail'); out.archived++; }
  }
  out.newItems = items.length;
  const merged = items.concat(digest.items || []).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const next = {
    updated_at: now.toISOString(), keep_items: keep, lastUid: Math.max(digest.lastUid || 0, ...headers.map(h => h.uid), 0),
    total_classified: Number(digest.total_classified || (digest.items || []).length) + items.length,
    total_is_floor: digest.total_is_floor ?? !digest.total_classified,
    items: merged.slice(0, keep),
  };
  log(`fetched ${out.fetched}, new ${out.newItems}, labelled ${out.labelled}, archived ${out.archived}, digest ${next.items.length}/${keep}`);
  return { digest: next, ...out };
}

/** Prompt + parser for the model adapter. Kept here so the eval set scores exactly what production sends. */
export function buildPrompt(batch, categories) {
  return {
    system: `You sort email by its envelope only. For each item you get a sender and a subject line — nothing else, and you must not guess at bodies. Reply with JSON only: an array, same order, of {"category": one of ${JSON.stringify(categories)} or "other", "action": true if the email is waiting on a reply from the recipient or carries a real deadline, "reason": one short clause}.`,
    user: JSON.stringify(batch),
  };
}
export function parseVerdicts(text, n) {
  let arr;
  try { arr = extractJson(text || '', 'array'); } catch { return Array(n).fill({}); }   // no array → every item falls back to "other"
  return Array.from({ length: n }, (_, i) => (arr[i] && typeof arr[i] === 'object') ? arr[i] : {});
}

/* ---------------- adapters (only used when run as the Action) ---------------- */
async function imapAdapters(env) {
  const { ImapFlow } = await import('imapflow');
  const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD }, logger: false });
  await client.connect(); await client.mailboxOpen('INBOX');
  return {
    client,
    async fetchHeaders({ sinceUid, since, primaryOnly }) {
      const query = since ? { since } : sinceUid ? { uid: `${sinceUid + 1}:*` } : { since: new Date(Date.now() - 7 * 864e5) };
      if (primaryOnly) query.gmailRaw = 'category:primary';
      const out = [];
      for await (const msg of client.fetch(query, { uid: true, envelope: true })) { // envelope only: no body, no text
        const env2 = msg.envelope || {}; const from = (env2.from || [])[0] || {};
        out.push({ uid: msg.uid, msgid: env2.messageId || null, subject: env2.subject || '(no subject)', from: from.address ? `${from.name ? from.name + ' ' : ''}<${from.address}>` : '(unknown)', date: env2.date ? new Date(env2.date).toISOString() : new Date().toISOString() });
      }
      return out;
    },
    labelMessage: (uid, label) => client.messageFlagsAdd({ uid }, [label], { uid: true }).catch(() => client.messageCopy({ uid }, label, { uid: true })),
    moveMessage: (uid, folder) => client.messageMove({ uid }, folder, { uid: true }),
  };
}
/** Any provider through ./llm.mjs: Claude (default, claude-haiku-4-5-20251001), OpenAI, Gemini, OpenAI-compatible. */
export function modelClassifier(cfg) {
  return async (batch, categories) => {
    const { system, user } = buildPrompt(batch, categories);
    const res = await complete(cfg, system, user, { maxTokens: 2048 });
    return parseVerdicts(res.text, batch.length);
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (isMain) {
  const env = process.env, root = process.cwd();
  const read = f => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
  const config = read(path.join(root, 'mail/config.json')) || { enabled: false, categories: [] };
  const digest = read(path.join(root, 'mail/mail.json')) || { items: [] };
  if (env.DRY_RUN === '1') { console.log('DRY_RUN=1: not connecting to IMAP or the model; nothing changed.'); process.exit(0); }
  let cfg = null, missing = [];
  if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) missing.push('GMAIL_USER / GMAIL_APP_PASSWORD');
  try { cfg = configFromEnv(env, { defaultModel: 'claude-haiku-4-5-20251001' }); } catch (e) { missing.push(e.message); }
  if (missing.length) { console.log(`Not configured (${missing.join('; ')}): skipping (exit 0).`); process.exit(0); }
  console.log(`model: ${describe(cfg)}`);
  const imap = await imapAdapters(env);
  try {
    const result = await sortMail({ config, digest, fetchHeaders: imap.fetchHeaders, labelMessage: imap.labelMessage, moveMessage: imap.moveMessage, classify: modelClassifier(cfg), backfillDays: Number(env.BACKFILL_DAYS || 0), log: console.log });
    if (!result.skipped) fs.writeFileSync(path.join(root, 'mail/mail.json'), JSON.stringify(result.digest, null, 2) + '\n');
  } finally { await imap.client.logout(); }
}
