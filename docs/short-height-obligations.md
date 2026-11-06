# Short-height browser obligations

Baseline: `0162f8102300b2e892cd7a66bd2f4d56039a3840`. The native case is
`short phone shells and enlarged dialog titles leave focused controls visible`
in `tests/short-height-browser.test.mjs` (one case, no suites; only missing
Chrome may skip). Its dataset is the bundled `open-f2p` provider with the
synthetic `duoFixture`, two selected chunks and both optional roll controls.
No random seed changes: server random is always `0.25`.
The provider digest is
`f129828c58260ba4894f2cb6ed7287c07c8f5360cb8d0a1716a5f26ddb9dfbc0`;
the serialized synthetic definitions/state/task-map digest is
`ee6d0b77617425a07c66be75d38bc805cb7b63995c5f70bb557302885e4f6a44`.
Each row retains these identities in its receipt.

Manifest identity: occurrence **1**, kind **test**, **0 suites**, ordinary full
CI lane on the existing supported platforms. Expected status is pass; the cited
failed CI attempt remains a first failure, and the sole permitted skip remains
`Chrome not found`. No old native case is deleted, renamed, split or replaced
with a new skip. The new phone-layout unit witness is an additional case.

The original native case identity, dataset policy, and missing-Chrome skip
reason are unchanged. This document and the ordered `observationNames` export
are the old-to-new assertion map; the wrapper checks the exact matrix and every
receipt name, rather than trusting an aggregate count.

Baseline SHA-256 (repository LF bytes):

- test: `f3eb9d6eb1718365c849f3aaad5ecd156cfedd43f7ad9b374ca9ddfefadf90cb`
- driver: `2b81d6047a4361d843a85073dd1b1daa63ff48457e7c84a0899a153f435f93ad`

The full matrix is `{16,24}` browser font preferences × `{240,256,844}` CSS
viewport heights × `{true,false}` backup notice visibility; width is 320.
All twelve combinations retain native forward and reverse Tab input. Font 24
also retains Chrome's minimum font preference of 24, rather than approximating
it with a root CSS font override.

| Old obligation | Replacement receipt / assertion | Per combination |
|---|---|---:|
| Initial settlement | `initial layout`; fresh warning, actual browser font, workspace ≥120 px | 1 |
| Nine `tabTo` targets | `Roll visible`, `Controls visible`, `Forfeit visible`, `Cancel visible`, `task search visible`, `task visible`, `result Controls visible`, `result Roll two visible`, `result visible`; target ≥44 px, whole vertical box visible (1 px tolerance), center hit belongs to target | 9 |
| Controls expansion settlement | `controls expanded` | 1 |
| Confirmation dialog Tab walk | `confirmation:{forward,reverse}:{0..6}`; each control wholly visible and owns its center hit | 14 |
| Cancel settlement | `confirmation closed`; dialog closed | 1 |
| Short task search settlement | `short task search` | 1 |
| Short task dialog Tab walk | `task detail:{forward,reverse}:{0..6}`; same clipping and hit checks | 14 |
| Escape after short task | `task detail closed` | 1 |
| Long task search settlement | `long task search` | 1 |
| Long task reachability settlement | `long task reached`; native Tab reachability | 1 |
| Long task dialog Tab walk | `wrapping task title:{forward,reverse}:{0..6}`; same clipping and hit checks | 14 |
| Final Escape settlement | `wrapping task closed`; dialog closed | 1 |
| **Total** | Named, unique receipts retained even for Chromium's body wrap stop | **59 ×12 =708** |

Additional original assertions remain: title fully within viewport/header,
font-24 title wraps beyond 1.5 lines, no runtime errors, fresh backup warning
before hiding it, Cancel and Escape close the dialog. Task-body client/scroll
heights and Roll/title geometry remain in each row. Body wrap stops are
recorded explicitly instead of silently disappearing from the observation count.

The short-task query is `Own sword`, an actual task in the same fixture.
The old `OwnItem` query does not name a rendered task label: its "any row"
readiness predicate could inspect the stale Partner sword row before the
100 ms search debounce, or leave no Tab target after it. The replacement waits
for query-specific rendered content, preserving the intended distinct short
and long dialog witnesses.

Readiness must be independent of those assertions: fonts complete, expected
viewport and phone media applied, native focus event acknowledged, and equal
layout/scroll snapshots across consecutive animation frames. A stable clipped
box must fail immediately; no visibility predicate is a readiness condition.
Samples are taken in a task after rendering and ResizeObserver delivery, then
geometry is captured atomically with settlement. Each receipt includes its
settled geometry and focus-event count. Target
searches stop after one complete native focus cycle when the target is absent.

## Product regression

The original CI failure (run 42297738939, job 128167284112) reports Roll at
top 144.75, bottom 188.75, height 44, visible 39.25, with its center hit still
owned by the button. The fixed tabs begin at 184 in that 240 px viewport.
The readiness rebuild also exposed settled clipping locally in the same
font/height/notice combination: Controls at 148.75–192.75, height 44, visible
35.25. Thus passing center-hit ownership alone does not protect the whole box.

This is a product defect. Root scroll-padding is only a scrolling hint; it
does not reduce the native scrollport when Chromium considers a focused
sibling already inside the viewport. The phone body now scrolls in the actual
space above the fixed tabs. `native scrollport excludes fixed tabs` asserts
this geometric invariant once per combination, independently of the original
Roll/Controls clipping checks. It fails against the old layout even when a
particular native focus scroll happens to land clear of the tabs. Modals use
the browser top layer and correctly escape clipping by body/html.

The screen-bar observer also reveals the focused target during banner-resize
delivery, before paint, rather than scheduling a later animation frame.
Native focus scrolling can finish before a later banner moves the target down;
the observer corrects that displacement without changing focus or reacting to
ordinary user scrolling. A deterministic unit witness preserves the historical
39.25/44 geometry and a subsequent 44 px banner growth. The hosted proof restores
the old observer in an isolated checkout and requires this witness to fail once.

Timing holds the fixed product constant and compares the old sleep-based harness
against the replacement. Its old harness receives only the actual Own sword query
and the top-layer ancestor boundary correction, retaining all 708 mandatory
180 ms sleeps. The receipt records that harness's exact hash and all first outcomes.
