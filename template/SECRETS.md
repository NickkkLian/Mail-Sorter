# Secrets the template needs (names only — values live in your private repo's Actions secrets, never in any file)

| Secret | What it is | Scope |
| --- | --- | --- |
| `GMAIL_USER` | the Gmail address to sort | — |
| `GMAIL_APP_PASSWORD` | a Google *app password* (Google Account → Security → 2-Step Verification → App passwords). It is a scoped credential you can revoke on its own; the script uses it over IMAP and never stores it. | IMAP only |
| one model key | `ANTHROPIC_API_KEY` (Claude, the default) · `OPENAI_API_KEY` · `GEMINI_API_KEY` · `LLM_API_KEY` (an OpenAI-compatible server, only if it needs one). The script sends **sender + subject only**, in batches of 25 | that provider's API |

Which model: set repository **variables** (not secrets) — `LLM_PROVIDER` = `anthropic` (default) · `openai` · `gemini` · `openai-compatible`; `LLM_MODEL` = a model id (required unless you use Claude, which defaults to `claude-haiku-4-5-20251001`); `LLM_BASE_URL` for an OpenAI-compatible server. The script calls each API directly over HTTPS (`mail/scripts/llm.mjs`, no SDK) and sends keys in headers only.

The board in the browser never sees any of these. It holds only a fine-grained GitHub token (Contents read/write on the one private data repo), stored in `localStorage`.

Optional environment: `BACKFILL_DAYS` (set by the manual workflow input), `MODEL` (older name for `LLM_MODEL`, still honoured), `DRY_RUN=1` (log and exit without connecting to anything).
