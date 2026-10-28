# Headersort

Sort mail worth keeping, review outdated mail, archive with undo.

[Open the fictional demo](https://nickkklian.github.io/Mail-Sorter/?demo=1). The digest board now includes a cleanup review grouped by rule. Untick an item or rule, protect a sender, then approve the selection. Approval and Undo queue work for the next scheduled runner; the board never connects to Gmail.

Rules propose; a model can choose a keep category or veto cleanup. A model cannot authorize cleanup. Public settings start disabled, bodies off, all Inbox tabs, daily reviews, archive only and approval every run. No permanent-delete operation exists. Optional Trash and automatic rules are available only through explicit settings; Trash is removed by Gmail after 30 days, and automatic eligibility requires at least 28 clean reviewed days.

## Install in a private repository

1. Copy the contents of `template/` into the private repository. For an existing installation, preserve its digest and runtime state; initialize the five cleanup/runtime state files only if absent. Use the supplied `mail/scripts/package-lock.json` with `npm ci` in that directory.
2. Configure `mail/config.json`. Keep `approval_mode: "every_run"`, all rule actions `archive`, and all rule `auto` flags false. Set `enabled:true` when ready to generate proposals. Keep body reading off unless you choose to allow it.
3. Add the Gmail and model secrets listed in [template/SECRETS.md](template/SECRETS.md). The supplied workflow preserves two daily wakes at 15:00 and 22:00 UTC, serializes them in `mail-sync`, and uses the private Contents API to persist intent before changing mail. Its original example wires Anthropic; other supported providers require their corresponding secret environment mapping.
4. Run *Mail Classify*. It scans oldest Inbox mail, bounded by `max_per_run` (120 by default). Manual `backfill` raises that page limit to `max_backfill` (3000); overflow continues on later daily scans. `run_now` bypasses only the daily proposal cadence. Both keep the approval boundary.
5. Serve `index.html`, `board/` and the shared `mail/scripts/settings.mjs` from the same HTTPS site. Set the board's repository owner/repo defaults for your private setup, or use an existing browser connection. The fine-grained browser token needs only Contents read/write on that private repo.

The public board has empty connection defaults. It uses the existing GitHub Contents client and conflict-aware config editor. Tokens stay in browser localStorage. Review text is rendered as text, and script sources/inline hashes are restricted by CSP. Deploy board modules and the matching index/CSP together.

Each digest message with a stable Gmail ID has a **Dealt** button. **Mark all shown as dealt** queues only the current filtered page (at most 150 messages). On the next enabled `mail-sync` wake, the runner adds the configured category label, including Unsorted, and marks the message read by default. It keeps the message in Inbox. Settings → App-specific → **Mark dealt mail as read** can turn off the read change; explicitly Save the switch. The setting in force when the runner executes is used. Scheduled wakes are 15:00 and 22:00 UTC and can be delayed.

Dealt history has Undo for every queued action. Undo before execution cancels that request; Undo after execution queues restoration on the next enabled wake. Only a previously unread message changed by Dealt becomes unread again, and only a category label added by Dealt is removed. Existing labels and read state are preserved. Interrupted operations are quarantined, never automatically replayed, and can be undone. Dealt consumption records remain in the journal so an old queued request cannot replay when cleanup history is pruned. Normal classifier scans do not re-add labels removed by dealt Undo. A stale category, missing stable ID, missing message, unknown read/label state or a message outside Inbox is skipped safely; history reports skipped counts.

## What stays private

`mail/config.json`, `mail/mail.json`, `runtime.json`, `cleanup-proposal.json`, `cleanup-log.json`, `cleanup-approval.json`, `cleanup-undo.json` and `dealt-queue.json` belong in the private repository. Only empty state and example settings ship in the template. Never add a real digest, sample pool or reviewed test set here. Existing installations can leave `dealt-queue.json` absent until the first Dealt action creates it; preserve it thereafter.

At first cut-over, protective senders are seeded once from existing keep-category digest metadata. Every run also indexes Sent correspondents/threads. Protected senders/domains, keep labels, stars, written-to correspondents and participated threads veto cleanup; incomplete safety metadata leaves mail in place. No old Gmail labels are renamed or removed.

Cleanup attaches `AI/Cleaned/O1` through `O7` and archives only selected messages that still match on a fresh read. Archive undo restores Inbox and missing original custom labels without altering read state. Its queued status is explicit. The two scheduled wakes also process approvals/undo even when no new daily review is due. For immediate processing, manually dispatch the workflow. No workflow-dispatch permission is needed by the browser.

Rules cover old one-time codes, shipping notices, past events, promotions, newsletters, app/social notices and routine resolved security notices. Uncertain or overlapping evidence stays. Eight keep categories plus Unsorted use stable keys; Needs reply is a separate flag. The digest is capped independently of the retention scan.

Body reading is optional. When enabled, bounded text/calendar parts can be read and a short redacted excerpt sent to the configured model for undecided mail. Quoted history and common identifiers are stripped; bodies and provider error payloads are never persisted. Redaction cannot guarantee removal of every personal detail. See the settings before opting in.

## Offline checks

Node 22+. No dependency installation, credentials, local server or network is needed:

```sh
node template/check.mjs
node template/check-llm.mjs
node scripts/privacy-check.mjs
node scripts/verify-shared.mjs
node eval/score-cleanup.mjs
node eval/score-cleanup.mjs --break
node check-csp.mjs
node check-csp.mjs --self-test
DRY_RUN=1 node mail/scripts/classify.mjs
```

The suite preloads a network blocker and tests rules, protection, disabled behavior, provider request shapes, durable journal ordering, approval conflicts/replay, interrupted operations, undo and the real review renderer in a DOM harness. The 200-message cleanup fixture is entirely synthetic. Its scores are safety checks, not measured mailbox accuracy.

Optional browser checks use Playwright Core and a headless Chromium installation: `PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs CHROME_PATH=/path/to/chromium node scripts/browser-dealt.mjs`. The script serves this checkout on localhost:8765, blocks external requests, and tests EN/ZH, light/dark, desktop/phone, Dealt, bulk, Undo and Settings. A synthetic in-memory Contents API verifies the connected UI without a repository token or mailbox. Screenshots go to `evidence/` (override with `EVIDENCE_DIR`).

`DRY_RUN=1` exits without connecting or writing state. `DRY_RUN=proposal` is a separate metadata-only mode for an enabled local installation: it writes proposals/digest locally, suppresses every mailbox mutation, ignores queued approvals/undo, disables body/model reads and refuses GitHub state. Use only in a disposable copy for testing; its policy differs from body-enabled settings. The release integration test injects fake IMAP.

The historical 40-message cached label evaluation is retained as `node eval/score.mjs` and `--break`. It measures the earlier eight-category model experiment, not the new keep/cleanup policy. Live cache generation is retired.

## Shared code and limits

`mail/scripts/` and `board/` are the canonical implementation. The template contains byte-identical runtime, rules and board files; `verify-shared.mjs` rejects drift. Config and state are examples, not personal settings. `template/check.mjs` is the repository compatibility entry point.

The board retains its digest counts, trend, filters, Gmail links and appearance controls. New review controls are English. Fake IMAP and injected providers verify code paths offline; live Gmail folder semantics, deployed browser rendering and real model quality require operational verification. GitHub schedules can be delayed. The preserved twice-daily schedule means approval/undo may wait until the next wake.

MIT — see [LICENSE](LICENSE).
