# Large portable backups

Backup & Import downloads `.json.gz` and accepts both `.json` and `.json.gz`,
including the JSON extracted from the scheduled backup ZIP. The helper still
uses the ordinary `/api/backup` JSON response; its ZIP format is unchanged.

The file ceiling is 256 MiB of UTF-8 JSON after decompression, about seven times
the 2026-10-13 full save. Wire requests allow 257 MiB for gzip overhead. These
limits apply only to import/restore routes; other request limits are unchanged.
Compressed downloads check the JSON size before starting, so the dialog never
offers a completed download above the import ceiling. This remains a finite
memory safeguard, rather than a promise to restore arbitrarily large JSON.

`app/web/backup-transfer.mjs` streams file bytes through an optional gzip decoder
and `CompressionStream`, respecting backpressure. It prepares one compressed
Blob for Preview and reuses it for Apply; revision and player options remain in
a small separate header. Browsers without compression upload a Blob containing
the JSON wrapper directly. Browsers without gzip decompression can use the
extracted JSON file. The browser does not parse or stringify the full save.

`app/backup-transfer.mjs` bounds compressed and expanded bytes and feeds
`app/storage/json-stream.mjs`. That parser builds objects from primitive tokens,
validates UTF-8 and JSON syntax, and limits nesting to 128 levels. Source text
is retained only for the current token/chunk, not the whole document. Downloads
serialize bounded batches into gzip instead of building a complete JSON string
and Buffer. A single import admission covers receiving, previewing or applying
one backup; additional import requests receive a retry message.

The complete parsed state and existing validation/storage copies still require
memory. Large individual string tokens also need their complete string text.
This change removes transport-sized text copies and a redundant full restore
validation; it does not replace the state model or its validation boundary.
Origin, authentication, administrator access for whole-save replacement,
player-only restoration, session rechecks, revision checks, previous-state
retention and the restore Undo boundary remain in the existing server paths.

## Copied-save findings

Measured only on a copy of `.local/duo`, excluding `store.lock` and `access-token`.
The source save was never changed. Sizes below are compact UTF-8 JSON; no save
contents or invitation credentials were emitted.

| Section | Bytes | Count |
| --- | ---: | ---: |
| Migration provenance | 22,336,831 | 11 task identity migration fields |
| Identity registry | 13,237,812 | 23,925 entries; 91,441 aliases |
| Task catalogue | 2,188,750 | 23,925 tasks |
| Original imported records | 192,173 | — |
| History | 141,086 | 76 events |

The full state is 38,146,360 bytes; its portable envelope is approximately
38.15 MB. Migration provenance and identity mappings dominate this save, so
discarding or truncating History would not solve its size problem. No records
were removed or changed to make the backup smaller.

## Verification

`tests/backup-import-server.test.mjs` generates a full backup above 32 MiB,
uses the browser transfer helper for Preview and Apply, and verifies the gzip
download preserves every generated provenance row. Focused tests cover gzip
files, compressed JSON requests, invalid/corrupt input, byte/depth limits,
revision conflicts, security and scoped restores. Transport instrumentation
checks that only primitive tokens reach `JSON.parse`; state validation keeps
its existing independent checks. New cheap parser/transfer tests are classified
in the quick suite, and the large server fixture is full-only.

The locked copied-save acceptance run on 2026-10-13 downloaded 5,550,174 gzip
bytes and applied the full backup once in 8.47 seconds. Sampled process RSS
peaked at 2,422 MiB during Apply, from a 1,493 MiB post-startup baseline. The
OS-reported lifetime high-water mark was 2,529 MiB, including startup, export
and preview. RSS includes the resident task worker threads; this is not a
transport-only measurement. A 10 ms sampler can miss brief synchronous peaks,
so both measures are reported. Existing full-state validation still makes
restores substantially more expensive than ordinary saves. The 256 MiB ceiling
has not been validated with a real save at that size.

The same isolated server/browser session checked the dialog at 1440×900 and
390×844; neither viewport had horizontal dialog overflow. Screenshots and the
numeric acceptance report are retained in `.local/screens/` and
`.local/bigimport-acceptance.json`. The real copied save and exported file were
deleted afterwards. No original save, invitation record or live server changed.

Final validation: quick suite 873/873 passed; 22 new focused parser/transfer/import
tests passed. The full suite ran once under the shared lock: 3,435 passed,
one optional generated-PNG asset check skipped, zero failures (254.7 seconds).
