# Add a second Gmail mailbox

The scheduled backend can read two Gmail accounts. Existing `GMAIL_USER` and
`GMAIL_APP_PASSWORD` keep serving the primary account. The optional second account
uses `GMAIL2_USER` and `GMAIL2_APP_PASSWORD` in the **private data repository's
Actions repository secrets**, never in this public app or a configuration file.

1. Sign into the second Google account. Enable 2-Step Verification, open
   [App passwords](https://myaccount.google.com/apppasswords), and create an app
   password named “Mail Sorter”. Google documents prerequisites and unavailable
   account types in [App password help](https://support.google.com/accounts/answer/185833).
2. In the data repository, open **Settings → Secrets and variables → Actions →
   New repository secret**. Add `GMAIL2_USER` with the second email address and
   `GMAIL2_APP_PASSWORD` with its new app password (remove display spaces).
   [GitHub's instructions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)
   describe this screen. Keep existing primary/model secrets.
3. In Mail Sorter, open **Settings → App-specific → Enable second mailbox**,
   turn it on, and press **Save second mailbox setting**. Keep scheduled
   classification enabled. The next enabled mail-sync wake reads both accounts.

The switch defaults off. Missing either second secret emits a fixed “secondary
mailbox not configured” note and leaves the primary run successful. An actual
connection or classification failure reports failure after the other account's
progress is saved. Turning the switch off pauses secondary sync, queued actions,
and Undo; it preserves the account's digest and history.

Each digest item records `mailbox` (`primary` / `secondary`) and `mailbox_address`.
The board shows an address badge and a mailbox filter that combines with category
and search. Bulk Dealt covers only the rendered filtered page (maximum 150).
Cleanup selections and Dealt requests retain the mailbox scope. Undo uses that
scope's journal and before-images; identical Gmail IDs or Message-ID headers in
different accounts do not collide. Gmail links select the recorded account.

Legacy records without a mailbox field belong to primary. Cursor, UID validity,
cadence, counts, automatic-review history, quarantine, and journal consumption
are independent per mailbox. `keep_items` applies per mailbox (the combined
digest can contain twice that many items). Cleanup rules and protection settings
remain shared. The existing global `enabled` switch pauses both accounts.

The runner binds each mailbox slot to its first configured address. Changing
that address later fails closed rather than applying queued decisions to a new
account. Replacing an account needs a separately reviewed state migration.
After changing settings, refresh and review a fresh cleanup proposal; policy
changes invalidate old approvals. Do not run the historical one-off recovery on
the combined digest, or roll the runner back to code that lacks mailbox scoping.
