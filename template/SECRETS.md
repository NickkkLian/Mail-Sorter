# Private runner environment

Store values only in the private repository's Actions secrets.

| Name | Purpose |
| --- | --- |
| GMAIL_USER | Gmail account |
| GMAIL_APP_PASSWORD | Google app password for IMAP |
| ANTHROPIC_API_KEY | Default Anthropic adapter |

The shipped workflow retains these three secret names. It also maps repository variables `LLM_PROVIDER`, `LLM_MODEL`, `LLM_BASE_URL`. Claude defaults to `claude-sonnet-5-5`. Other supported adapters require adding their corresponding secret mapping: `OPENAI_API_KEY`, `GEMINI_API_KEY` or `LLM_API_KEY`. Never put keys in config or workflow literals.

The workflow maps its job token to `GITHUB_TOKEN` and repository identity to `GITHUB_REPOSITORY`, with `STATE_BACKEND=github`. This commits journal intent through the Contents API before mailbox changes. Do not add a checkout-state commit/push step afterward.

`RUN_NOW=1` bypasses proposal cadence. `BACKFILL=1` uses the larger bounded scan limit. The old `BACKFILL_DAYS` input is replaced by the boolean bounded Inbox sweep.

`DRY_RUN=1` exits without connecting. `DRY_RUN=proposal` writes metadata proposals to disposable local state while suppressing labels, archive, undo, bodies and model requests; it refuses hosted state. No dry mode is set by the production workflow.

The browser holds only a separate fine-grained token with Contents read/write on the private data repo. It never receives Gmail or provider credentials.
