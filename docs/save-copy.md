# Scrubbed release save

`scripts/save-copy/scrub-save.mjs` turns an explicitly supplied disposable
`rs3-chunk-picker` schema-1 JSON backup into a release-test candidate. Node 24,
Git and the selected public game packs are required. It never discovers a live
save, launches the picker, uploads an asset, or changes GitHub settings.

Run it in the checked-out release source, with the public duo data/rules packs
selected through `RS3_DATASET=duo-legacy`, `RS3_PACKS_DIR` and
`RS3_PACK_SELECTION`. Use the same pack selection for checking and loading.
Clear private dataset/profile/default overrides first. Pack selection and
corpus files remain local. See [secret-scan.md](secret-scan.md) for corpus setup.

```sh
node scripts/save-copy/scrub-save.mjs /outside/repo/raw.json /outside/repo/scrubbed.json --report /outside/repo/categories.json --corpus-dir /outside/repo/corpus
node scripts/save-copy/scrub-save.mjs --check /outside/repo/scrubbed.json --corpus-dir /outside/repo/corpus
```

Outputs must be new files outside the source tree. Input, output and report
aliases are refused. JSON
is parsed by Node, preserving keys that differ only by case. Errors contain
categories, never parser snippets, save values or paths supplied by the save.

Identity, account, display-name, member, map, invitation, credential, network
and machine bindings become stable placeholders. Member/map references and
dictionary keys are rewritten together. Free text in notes, journals, actor
labels, stickers, backlog reasons and nested History/Undo snapshots is scrubbed.
Custom text has no exemption just because it resembles a game word. Private
source hashes become a fixed public sentinel, rather than a hash of the input.

Game vocabulary is grounded in committed public catalogues and the selected
engine's authored identities. A string is never trusted solely because it
begins with `rs3:` or appears elsewhere in the input. Unknown strings and keys
are replaced and reported; unknown personal numbers are replaced too. No
replacement dictionary, raw value, private digest or original dynamic key is
written in the report. Placeholder numbers identify values only within a file;
they are not hashes of the originals.

The category report counts containers, keys and scalar values at every path,
using `[]` for arrays and `{key}` for dynamic keys. Rows record data kind,
JSON type, action and count. Totals include `kept`, `replaced` and `dropped`;
the current scrubber drops nothing. This is an inventory, not a list of values.

Before writing a candidate, the scrubber checks its own output for remaining
policy replacements, runs the repository secret scanner without line
exceptions, and invokes the application's actual backup importer. The scanner
checks distinct decoded keys, strings and numeric spellings in bounded batches,
including those in archives. `--check`
repeats these checks. The private HMAC corpus is used when present at the
scanner's default location or `SECRET_SCAN_CORPUS`; an explicit `--corpus-dir`
is required to exist and be valid. An absent default corpus is reported as
absent. GitHub checks patterns and policy; the release PC also checks its
private corpus before publication.

For a load proof, use a new scratch directory outside the repository and an
unused port from 8900 through 8999:

```sh
node scripts/save-copy/prove-load.mjs --save /outside/repo/scrubbed.json --compare /outside/repo/raw.json --scratch /outside/repo/new-scratch --port 8967 --report /outside/repo/load-proof.json
```

This starts one loopback picker through `createServer({initialImport})`, the
same backup-import route used by application tests. It verifies authenticated
health, session, full state and per-member task endpoints. Member, saved-task
and per-member chunk counts must match the scrubbed copy and optional raw-copy
comparison. Normal import retains the incoming History and starts a new active
History with an import event; active counts are reported separately.
Credentials stay in memory. A `finally` block closes
the server and its worker before a successful proof is written. Scratch files
are retained locally for inspection.

Before each release, generate a fresh local candidate, inspect the English
report, run `--check` with the current private corpus, and repeat the load
proof with the release's pinned public packs. Game progress and event times
remain visible; this preserves load compatibility and does not promise
anonymity against someone already familiar with that progress.

Proposed CI integration: download an approved release asset pinned by size
and SHA-256, select the matching public packs, run `--check`, then run the load
proof with a new runner-temporary scratch directory and port. Keep the raw
backup and private corpus on the release PC. Workflow edits and asset
publication are outside this job; the operator approves the asset before upload.

Focused verification:

```sh
node --test --test-timeout=120000 tests/save-copy.test.mjs
node scripts/secret-scan/scan.mjs --commits BASE..HEAD --corpus-dir /outside/repo/corpus
```
