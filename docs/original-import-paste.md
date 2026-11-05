# Import from the original RS3 chunk picker by paste

This is the backup route for importing from [Source Chunk's original RS3 chunk
picker](https://github.com/source-chunk/chunk-picker-rs3). Map-code reads belong
to a later change. This adapter parses text locally in our import workers. It
does not contact the original service, write to it, collect credentials or ask
players to paste scripts into a console.

## Feature flag and coverage

`RS3_ORIGINAL_IMPORT_PASTE` is off unless its value is exactly `1` in the server
process. After setting it, restart the server. Both the authenticated session
and import handler enforce the flag; changing browser state cannot enable it.
Leave it off until the original project's maintainer has been told about the
feature. This change does not enable the flag in any launch or release script.

The entry appears in **More → Saves → Export / Import** on a compatible
`duo-legacy` dataset with `surface-grid-v1` coordinates. Open F2P and starter
datasets are refused: they need reviewed chunk/task correspondence before they
can activate original progress. Stored drawing IDs are not plugin coordinates.

## Player workflow

Choose **Import from the original chunk picker**, then a destination player.
Paste the original's **Miscellaneous Actions → Chunks** clipboard export and
**Rules** JSON. An empty chunk export means no owned chunks; use `{}` to import
no rules. The chunks field also accepts the documented legacy chunk URL.
Optional gameplay JSON must come from the original's own UI if it offers it.
This feature does not claim that a supported full gameplay export exists there.

Rules and task import start unchecked. Preview uses the existing upload worker,
**Match the players**, review token and **Apply reviewed replacement** flow.
It replaces one player map, preserves other players and shared rules, retains
the previous save and supports ordinary **Undo**. The preview lists territory
changes, original rule decisions and records that remain archive-only. Download
the transfer report for a bounded sample; download a full backup for all evidence.

## Mapping contract

The adapter independently implements the documented formats. It decodes
Firebase text once with the existing decoder, strips numeric `*fb*_` key
prefixes, and resolves task IDs with the destination's trusted, category-aware
identity index and tasksMap/history. Pasted lookup tables never become authority.

| Original input | Active destination behavior | Retention / limits |
| --- | --- | --- |
| Clipboard chunks | Known IDs become owned chunks | Clipboard is authoritative over captured ownership. Unknown IDs stay archived and are reported. |
| Legacy chunk URL | Decodes grid indices without opening the URL | Selected candidates use the original importer's descending grid-index order. No arbitrary URLs or map codes. |
| Captured `selected` | Numeric candidate ranks determine list order; older string-valued selections use descending chunk IDs | Exact values remain in pasted evidence. Invalid ranks/IDs stay archived. |
| Captured `potential`, `blacklisted` | Pending choices and excluded chunks, separately | Unknown chunks never become active territory. |
| Positive checks in all three task containers | Matched `challengeCompleted` flags | No personal quest, skill, achievement or item completion is invented. |
| Backlog / favorites | Matched membership, reasons and favorites when opted in | Empty backlog reasons count. Reason values use trusted tasksMap/history translations; missing or ambiguous translations stay raw and are reported. Alias comparisons use complete decoded reasons. Long reasons have a bounded active sample and an exact archived copy. |
| Unknown or ambiguous task keys | None | Reported with category/key; exact input remains in provenance. |
| Notes, annotations, custom tasks, section/area controls, roll timeline, display preferences and other branches | None | Reported and retained in the exact gameplay text. No foreign History/Undo is manufactured. |

Every supplied rule key receives one of these decisions. The full per-key table
is retained with the paste; the preview displays a bounded sample with before
and after values. Missing keys inherit the destination's current player rules.

| Rule key / classification | Decision | Reason |
| --- | --- | --- |
| `F2P` | Unsupported; reported | Changes shared content scope. Review separately in Rules. |
| Key present in the original rule inventory and our typed task rules, with `implemented-scope` behavior | Equivalent to the same destination player-rule key, when opted in and valid | Uses our established implementation scope. |
| Same intersection, with `category-gate` behavior | Equivalent gate for the destination's declared tasks, when opted in and valid | Original-only task/source generation does not carry over; the preview includes the coverage caveat. |
| Partial, retained-only, missing, no-effect or unrecognized key | Unsupported; reported | No established equivalent behavior. Nothing is activated by guesswork. |
| Invalid type/value, oversized value or multiple encoded keys decoding to the same rule | Unsupported; reported | Prevents invalid controls and ambiguous overwrites. |
| Absent key | No assignment | Absence means inheritance, never false. No supplied keys are silently ignored. |

## Threat model and acceptance bar

All pasted text is untrusted. Total chunks/rules/gameplay text is capped at
**8 MiB of UTF-8** in the browser encoder and authoritative worker. Transport
keeps the existing upload/decompression, admission, timeout and worker limits.
Rules/gameplay JSON must be objects; nesting beyond 128 is rejected before
parsing. Credential and account/session fields, including decoded `cookie`,
`auth`, `pin`/numbered PIN and `uid` keys at any depth, are rejected with fixed
messages before reports or archives are created.

All display output crosses #120's shared `import-output.mjs` bounds: 512-character
strings, 100-entry samples, depth/node/byte budgets and a response below 256 KiB.
Exact save/publication data uses the existing yielding `import-bytes.mjs`
protocol. `provenance.originalPasteImports` keeps the exact pasted text, options,
owner and complete rule decisions; browser projections exclude that archive.
Native full backups retain it, including after Undo.

The responsiveness bar is a main-thread gap below **100 ms** for inputs up to
the paste cap, including rejected input. The synthetic probes cover a maximum
string, 120,000 gameplay keys, 200,000 rule keys and excessive nesting, each
padded to exactly 8 MiB. They measure browser encoding, parse/preview, apply and Undo;
the deep case must reject without a state change. These are Node probes of the
browser helper and server pipeline, not measurements of the native browser's
textarea paste operation. No live player data or original service is used.

Application still requires the existing review token bound to exact bytes,
mapping, actor and revision. Authorization and revision are rechecked before
the atomic save; a previous-save checkpoint is written first. The test suite
checks flag-off denial, another player's denial, changed review bytes, stale
revisions, preview-only behavior, retained evidence, retained saves and Undo.
