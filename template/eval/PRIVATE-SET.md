# Private release check

Claude and Nick prepare 200 labelled metadata records in the private Database repo, never the public export.
Use the shape in `synthetic.json`, with `synthetic:false`, a fixed ISO `now`, and `reviewed_by_nick:true` only after
Nick checks the draft labels. Each O1–O7 and each of the eight keep categories needs at least ten records where available; sparse classes use the declaration below.
Expected outcomes are `{kind:"outdated",rule:"O1"}`, `{kind:"keep",category:"finance"}`, or `{kind:"uncertain"}`.
Record IDs are arbitrary local IDs, not addresses. No bodies, MIME sources or attachments belong in this set.

When fewer than ten real examples are available,
include them all and declare `available_in_set`, an object with all fifteen class
keys (O1–O7 and the eight keep keys), each a nonnegative integer. The coverage gate
requires `min(10, available_in_set[class])` and prints every shortfall from ten.
This declaration counts independently curated real examples, not sampling signals,
and must be reviewed with the expected outcomes. Missing declared examples still
fail validation. Without a declaration, the ten-per-class requirement remains.
The scorer cannot independently establish pool availability from the selected set.

Unreviewed private drafts can be inspected without certifying them:

```sh
node eval/score-cleanup.mjs --private /private/path/draft.json --draft
node eval/score-cleanup.mjs --private /private/path/draft.json --draft --break
```

`--draft` requires `synthetic:false` and `reviewed_by_nick:false`, prints DRAFT ONLY,
and never prints a release-gate pass. It cannot be combined with `--reviewed`.
The ordinary private release gate still requires both Nick's true review marker
and `--reviewed`; diagnostics do not approve cleanup or change any message.

Sender/subject/date/tab alone do not prove a message is safe. Include the metadata fields used in `synthetic.json`:
stable Gmail message/thread IDs as strings, existing labels, starred/important/replied/thread-participated/ever-written
flags, `inInbox`, and a true `protectionComplete` only after a complete Sent index. Missing safety data blocks cleanup.
Shipping sender and known notification signals also need verification. Never mark missing evidence true to improve recall.

After Nick's review, Claude can run locally in the private environment:

```sh
node eval/score-cleanup.mjs --private /private/path/reviewed-set.json --reviewed
node eval/score-cleanup.mjs --private /private/path/reviewed-set.json --reviewed --break
```

The scorer never prints messages or mismatched records. Exit 0 means the normal gate passed, or `--break` caught the
deliberately unsafe bank-mail rule. Exit 1 means the gate failed (or mutation escaped); exit 2 means invalid input.
Zero wrong cleans, 100% precision and at least 50% recall are gates; keep-label accuracy is reported separately.
This metadata scorer does not measure body/model accuracy. A separate reviewed body-sensitive audit must occur privately
without storing body text in the set; record only the sanitized, typed evidence/results and independently expected outcome.
Approval remains required even if the private evaluation passes.
