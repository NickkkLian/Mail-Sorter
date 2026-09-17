# Headersort

**Gmail triage that reads only sender and subject — and only adds labels.**

A scheduled GitHub Action reads new mail over IMAP, asks a small model to label each one from its sender and subject line, adds an `AI/…` label, and writes a capped digest into your private repo. One static HTML file renders the board. Nothing runs between the two daily runs, nothing costs anything at rest, and nothing ever reads a message body.

[![Check](https://github.com/NickkkLian/Mail-Sorter/actions/workflows/check.yml/badge.svg)](https://github.com/NickkkLian/Mail-Sorter/actions/workflows/check.yml)

![Headersort board: counts strip, where the digest went, seven-day trend, category filters and the mail list](docs/screenshot-board.png)

**Live demo:** https://nickkklian.github.io/Mail-Sorter/?demo=1 — sixty fictional emails over seven days, every address on the reserved `.example` domain. The demo connects to no repository and no mailbox; its only network requests are the web fonts. English by default, 中文 toggle in the header.

## Four constraints, all mechanically checked

Anything that reads your mail should be able to say precisely how little of it it touched. `node template/check.mjs` runs the classifier core on 20 synthetic emails with mock adapters and fails if any of these break:

1. **The model sees the sender and the subject line. Never the body.** The check asserts the model input carries exactly `from` and `subject`, and includes a negative control: an adapter that leaks a body is caught.
2. **It only ever adds a label.** The mock mailbox throws on any verb other than *label* (and *move* only for categories you list in `archive_categories`).
3. **The digest is capped.** `keep_items` bounds the summary file so a JSON file used as a database cannot grow without limit; the check feeds 20 emails through a cap of 15.
4. **One switch turns it off.** `enabled: false` in `config.json` means nothing is fetched, nothing is labelled, and the digest is untouched; the workflow exits before touching anything.

## What the board shows

- **Counts** — last 24 h, last 7 days, mail that needs action, the digest window against its cap, and the cumulative total the classifier has processed (a lower bound once the window has rolled).
- **Where the digest went** — one bar per category; the counts add up to the window.
- **Seven-day trend** — emails per day, with the action-needed share in amber.
- **Filters and search** — by category or ⚡ action; each row deep-links to the original message in Gmail by `Message-ID` and shows the model's one-line reason, so a wrong label is debuggable instead of mysterious.
- A connect card when no repository is set, a setup guide when the repository has no digest yet, an error with *Try again* when GitHub cannot be read (a refused token, no network), empty states when the digest or a filter is empty, dark and light themes, 375 px layout.

## How it fits together

```mermaid
flowchart LR
  G["Gmail (IMAP, app password)"] -->|envelope only| C["template/mail/scripts/classify.mjs<br/>sortMail(): batch of 25 sender+subject"]
  C -->|category · action · reason| M["your model: Claude (default) · OpenAI<br/>Gemini · OpenAI-compatible — JSON only"]
  M --> C
  C -->|AI/Category label| G
  C -->|capped digest| J["private repo<br/>mail/mail.json · mail/config.json"]
  J -->|GitHub Contents API, fine-grained token| B["index.html (this repo)<br/>the board"]
  B -->|enabled on/off| J
  T["template/check.mjs · check-llm.mjs · eval/score.mjs"] -. verify .-> C
```

| Concern | Approach |
|---|---|
| Schedule | GitHub Actions cron, twice a day. No server, no container, no always-on process |
| Mail access | IMAP with a Google **app password** — a scoped credential that can be revoked on its own, rather than full OAuth |
| Classification | A model of your choice — Claude Haiku by default, or OpenAI, Gemini, or any OpenAI-compatible server such as Ollama — on sender + subject only, batched 25 at a time; categories outside your config fall back to `other` |
| Storage | Two JSON files in a private repo: `mail.json` (the digest, capped) and `config.json` (categories, on/off switch) |
| Front end | One static HTML file, no build step, no dependencies beyond one web font. Reads the two JSON files through the GitHub Contents API |
| Secrets | The Gmail app password and the model key live in the private repo's Actions secrets (names in `template/SECRETS.md`). The browser only ever holds a fine-grained GitHub token, in `localStorage`, scoped to Contents on one repo |
| Failure mode | Missing credentials or `enabled: false` → the script exits 0 before logging in and changes nothing; a missing digest → the board renders a setup guide; a read that fails (refused token, no network) → the board says which and offers *Try again* |

## Running your own

1. **App password** — Google Account → Security → 2-Step Verification → App passwords → create one.
2. **Copy `template/` into your private data repo** (`.github/workflows/mail-sync.yml`, `mail/scripts/classify.mjs`, `mail/config.json`, `package.json`). Also copy `mail/scripts/llm.mjs`. Edit the categories in `mail/config.json`. Under Settings → Secrets and variables → Actions add the Gmail secrets and one model key listed in `template/SECRETS.md`; to use something other than Claude, set the repository variables `LLM_PROVIDER` and `LLM_MODEL` (and `LLM_BASE_URL` for an OpenAI-compatible server).
3. **First run** — Actions → *Mail Classify* → Run workflow, with `backfill_days` set if you want the existing inbox sorted in one pass. After that it runs on its own.
4. **Open the board** — serve your own copy of `index.html` with your repository filled in: set `owner` and `repo` in `DEFAULTS` near the top of its script (the public page has no repository set, so there is nothing for it to load). Then open Settings and paste a fine-grained GitHub token with Contents read/write on that one repo. It is stored in your browser and never written anywhere.

```sh
node template/check.mjs
node template/check-llm.mjs
node eval/score.mjs
node eval/score.mjs --break
```

### Model providers

`mail/scripts/llm.mjs` calls each provider's API directly with `fetch` — no SDK, so the template's only dependency is the IMAP client. Nothing provider-specific is required: the prompt asks for a JSON array in plain words, and anything that does not parse becomes `other`. Keys go in request headers only.

| Provider | Configure | What has been run |
|---|---|---|
| Claude (Anthropic) | default · secret `ANTHROPIC_API_KEY` | `node template/check-llm.mjs`: request and reply format against a local mock of the documented API, end to end through `sortMail` to `AI/…` labels. **Not run against the live API for this revision.** |
| OpenAI | variables `LLM_PROVIDER=openai`, `LLM_MODEL` · secret `OPENAI_API_KEY` | Same mock checks (sends `max_completion_tokens`, no `temperature`). Should work per OpenAI's documentation; **not run live.** |
| Google Gemini | variables `LLM_PROVIDER=gemini`, `LLM_MODEL` · secret `GEMINI_API_KEY` | Same mock checks (key in the `x-goog-api-key` header). Should work per Google's documentation; **not run live.** |
| OpenAI-compatible | variables `LLM_PROVIDER=openai-compatible`, `LLM_MODEL`, `LLM_BASE_URL` · optional secret `LLM_API_KEY` | Same mock checks. **Not run against a real Ollama, LM Studio or vLLM server.** A GitHub-hosted runner can only reach a server with a public address. |

`eval/headers.json` holds 40 synthetic sender+subject pairs (five per category). `node eval/score.mjs` scores cached model output against them and prints the keyword baseline next to it; envelope classification is easy enough that the baseline alone reaches 38/40, which is exactly why the eval reports both. Until a maintainer has run `node eval/score.mjs --llm` once with a key for any provider, it reports **NOT RUN** (exit 2) rather than a number; the cache records the provider, model and date; `--break` is the negative control. This is a small evaluation set, not a formal evaluation pipeline.

## Limits and what is not verified here

- The template has been exercised with mock adapters and a dry run only; it has not been run against a live Gmail account for this revision. The IMAP label call falls back from `messageFlagsAdd` to `messageCopy` depending on how Gmail exposes labels — confirm on your account before relying on it.
- Category quality depends on the model and on subject lines alone; the reason shown per row is the model's, not a fact.
- The board shows at most `keep_items` emails and at most 150 rows per filter.
- The scheduled workflow and its script run in your private repo, not here — this repository is the board plus a template. The private deployment that produced the earlier screenshots is not published.

## Files

```
index.html                 the entire board: tokens, layout, i18n dictionary, GitHub Contents client, renderer, demo data
template/                  the Action to copy into a private repo (workflow · classify.mjs · llm.mjs · config.json · package.json · SECRETS.md · check.mjs · check-llm.mjs)
eval/headers.json          40 synthetic envelopes → expected category · eval/score.mjs scores cached model output
docs/screenshot-board.png  README screenshot
```

## License

MIT — see [LICENSE](LICENSE).
