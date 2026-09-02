# Mail Sorter

A Gmail triage board with no server of its own. A scheduled GitHub Action reads new mail over IMAP,
asks Claude to label each one, writes a digest into a private repo, and a single static HTML file
renders the board. Nothing runs between the two daily runs, and nothing costs anything at rest.

**Live demo:** https://nickkklian.github.io/Mail-Sorter/?demo=1 — ten fictional emails, English by
default, 中文 toggle in the corner. The demo connects to nothing and sends no requests.

## The constraint that shaped it

Anything that reads your mail should be able to say precisely how little of it it touched. So the
classifier is deliberately underpowered:

- **It sees the sender and the subject line. Never the body.** That is enough to sort mail into
  categories and to spot a deadline; it is not enough to reconstruct what anyone said to you.
- **It only ever adds a label.** No deleting, no archiving, no marking as read, no moving between
  folders, no replying. The inbox is left exactly as it was found — the labels are the whole output.
- **The digest is capped.** `keep_items` in `config.json` bounds how many emails the summary file
  keeps, so a JSON file used as a database can't grow without limit and quietly slow the app down.
- **One switch turns it off.** The toggle in the header flips `enabled` in `config.json`; the
  workflow checks that first and exits before touching anything.

## What it does

- **Classify** — every morning, new mail since the last run is scored into categories you define in
  `config.json`. Each verdict carries a one-line reason, shown in the UI, so a wrong label is
  debuggable instead of mysterious.
- **Flag what needs you** — a separate `action` bit for mail that is waiting on a reply or has a
  real deadline, independent of the category. The board's ⚡ filter is usually the only view you need.
- **Backfill** — run the workflow by hand with `backfill_days` to sort an inbox that has been
  accumulating for a year, then let the daily run keep up with it.
- **Read the board, not the inbox** — counts for the last 24 h / 7 d, per-category filters, and each
  row deep-links back to the original message in Gmail by `Message-ID`.

## How it's built

| Concern | Approach |
|---|---|
| Schedule | GitHub Actions cron, twice a day. No server, no container, no always-on process |
| Mail access | IMAP with a Google **app password** — a scoped credential that can be revoked on its own, rather than full OAuth |
| Classification | Claude Haiku on sender + subject only, batched. Cheap enough that the monthly cost rounds to nothing |
| Storage | Two JSON files in a private repo: `mail.json` (the digest, capped) and `config.json` (categories, on/off switch) |
| Front end | One static HTML file, no build step, no dependencies. Reads the two JSON files through the GitHub Contents API |
| Secrets | The Gmail app password and the API key live in the repo's Actions secrets. The browser only ever holds a fine-grained GitHub token, in `localStorage`, scoped to Contents on one repo |
| Failure mode | If the digest is missing the board renders empty with a setup guide, rather than erroring. The workflow's own failures surface in the Actions tab like any other run |
| Language | English by default, 中文 via the toggle |

## Running your own

1. **App password** — Google Account → Security → 2-Step Verification → App passwords → create one.
2. **Secrets** — in the private repo that will hold your data: Settings → Secrets and variables →
   Actions → add `GMAIL_USER` and `GMAIL_APP_PASSWORD` (and your Anthropic key).
3. **First run** — Actions → *Mail Classify* → Run workflow, with `backfill_days` set if you want
   the existing inbox sorted in one pass. After that it runs on its own each morning.
4. **Open the board** — paste a fine-grained GitHub token with Contents read/write on that one repo.
   It is stored in your browser and never written anywhere.

The scheduled workflow and its script live in the private data repo, not here — this repository is
the board you look at. The README above describes the whole pipeline so the design is legible
without it.

## Files

```
index.html    the entire board: layout, i18n dictionary, GitHub Contents client, renderer
```

## License

MIT — see [LICENSE](LICENSE).
