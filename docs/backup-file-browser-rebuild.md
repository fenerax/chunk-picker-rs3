# Backup file browser obligations

Baseline: `055332ff0951b7a38011243043ae2f5558827ee2`, entry
`tests/backup-file-browser.test.mjs`. The baseline has three top-level native
tests, no suites, no duplicate names, todos or platform exclusions. Their full
names are `backup file purpose and filename in Chromium (Enter)`,
`backup file purpose and filename in Chromium (pointer)` and
`backup file purpose and filename in Chromium (Space)`. Each occurrence is 1.
The replacement retains these identities and order, with three passes and zero
skips when Chrome is available. The sole existing skip, `Chrome not found`, is
retained. The full-only/default-dataset execution policy is unchanged; the test
itself selects the synthetic `open-starter` dataset before importing the server.
Linux is its ordinary CI lane; this entry is not in the Windows slice.

Baseline Git blob identities (content digests): entry
`a2df26607c5d3ca0c6dd1aab9ec3211947fa512b`, `app/open-starter.mjs`
`8521cdc755644b52a99eca61fb3a0fc127806bc5`, and
`app/open-starter-data.mjs` `6366e27c70c0262f2a1d5ffaa7a365ab54ee0034`.
The proof receipt also records baseline SHA-256 and current input blob identities.

## Failure evidence and verdict

First-attempt hosted job logs were retrieved with `gh run view --attempt 1
--log-failed` from runs [42139795692](https://github.com/fenerax/chunk-picker-rs3/actions/runs/42139795692/attempts/1)
and [42269182861](https://github.com/fenerax/chunk-picker-rs3/actions/runs/42269182861/attempts/1).
The former times out at `open():124` in the Space-named case, before any Space
input or chooser; the latter times out in `click():24`, called at `open():123`,
before the pointer case can activate the file control. Both are test
synchronisation defects at launcher/dialog readiness, not evidence of a broken
Space handler or download. The old `Saved` probe does not join task painting,
menu toggles or layout; its visibility polling and eventual-dialog assertion
cannot distinguish those phases. No product change is justified by these logs.

## Old → new assertion map

Every row applies independently to all three unchanged native case identities.

| Old obligation | Replacement assertion / event |
| --- | --- |
| Production startup, unauthenticated state refused | `handle.ready`, 401 assertion, Page load plus startup-painted marker, independent fonts/layout settlement |
| Skip setup and restart persisted session | Real Skip input and pre-armed close event; exact revision, complete store state and state.json bytes across server restart; no reopened setup dialog |
| More → Export / Import | Pre-armed native toggle, dialog-open attribute and backup-health-render events, asserted details state and dialog title; independent centre-hit and press-focus checks |
| Empty preview alert | Disabled lifecycle completion followed by one alert/no-Apply assertion |
| Full backup contains bytes | Pre-input download listeners, real completion GUID, sole final filename, gzip magic/decompression and exact exported state equality |
| Enter, pointer, Space chooser for invalid and valid files | Native Tab focus for keyboard modes; exactly one real key pair or mouse press/release per selection; fileChooserOpened backend node, selectSingle and DOM.setFileInputFiles |
| Chosen filename updates | Pre-armed input change event, then exact visible filename |
| Invalid preview refused | Preview completion, full-backup error, no Apply and invalid filename AX |
| Valid preview reviews replacement, one Apply control | Preview completion, Review replacement heading, one Apply and no alert |
| Purpose/name/description for invalid, valid, empty | Full AX tree with one named button, exact filename descriptions; initial and reopened empty state |
| Label targets button, button type and aria-describedby relation | All three relation assertions repeated for invalid, valid and empty states |
| Escape and Close return focus to launcher or summary | Pre-input native close event, then one exact activeElement assertion; no focus-condition polling |
| Preview does not write or apply | Exact revision and state.json bytes after empty, invalid, valid and closed phases |
| No page errors | Runtime exception collection from before navigation through final close |

One browser is owned by the file. Every case owns a new incognito context,
target, store, server and download directory. Cookie and localStorage sentinels
prove context isolation. Context disposal precedes browser shutdown/profile
cleanup. No retry or timeout increase was introduced.

## Reproducing acceptance evidence

The ordinary Stability workflow automatically selects this edited entry for
50 first attempts on hosted Linux. Its existing budget and runner are unchanged.
An additional job in that same workflow runs `scripts/ci/backup-file-proof.mjs`
only for the rebuild branch: four separate temporary product mutations and
three alternating matched old/new file timings. No new workflow is required.
The script records head/baseline source identity, runtime, first outcomes and
wall times in `backup-file-proof/proof.json`; the baseline entry and all other
inputs are pinned by the recorded commits. Both variants use the same product,
starter dataset, Chrome discovery and disabled bytecode cache. A baseline failure
is retained, never retried or accepted as a timing pass. Mutation patches are
never committed. The script refuses non-Linux execution.

The PR body records the actual hosted receipts, local five-run proof, mutation
results and measured times. Normal full CI remains required alongside this map.
