# Original worker output comparison — 2026-10-07

This checkpoint compares the authored task engine with one fresh, offline execution of the original
`reference/original-picker/worker.js`. It uses the October 6 QXA worker payload and public map capture. The reference payload,
root definitions, and original worker are pinned by SHA-256 in
`out/reference-comparison/original-qxa-output.json`; the authored module hashes and complete compact
comparison are in `out/reference-comparison/comparison.json`.

## Safe reference execution

The harness runs the original worker in a Node VM with a cloned payload. `fetch`,
`XMLHttpRequest`, and `WebSocket` throw immediately. `importScripts` records the worker's lodash CDN
request and returns without resolving it; the worker contains no lodash calls. The VM has no Firebase
frontend, credentials, DOM, or filesystem API. It made no network request and performed no write to
the original map or audit fixture.

The fresh reference run completed in **12.657 seconds** and emitted a normal `current` result. The
authored engine evaluated each October 6 member view in **0.78–1.00 seconds** in the latest comparison run.
These are local observations rather than a controlled benchmark, but they confirm the new evaluation
path is already roughly an order of magnitude faster on this captured case.

## Active task selection

The important reference surface is the final selection, not every entry in `globalValids`. For
ordinary skills, the original worker's `tempChallengeArrSaved` selected four next tasks:

| Category | Selected task | Authored eligibility |
| --- | --- | --- |
| Attack | Wield a corrupt dragon weapon | Available |
| Defence | Wear a piece of corrupt dragon armour | Available |
| Firemaking | Craft infernal yew incense sticks | Available |
| Agility | Cross the crumbling wall (Falador) | Available |

The authored evaluator contains the necessary eligibility facts for all four selected rows. Each
matches by normalized category and label and is available, visible, and has no authored blocker.
The separate presentation module applies saved completion, backlog, level, boost, priority,
primary-method, and alternative-task rules; this comparison records the reference frontier coverage
rather than treating every eligible row as selected.

For Quest, Diary, and Extra, the original UI applies its saved completion, backlog, and presentation
rules to `globalValids`. On this capture every eligible special row was already completed or
backlogged, so the original active list had **zero** rows. The authored evaluator has 107 eligible
special rows before challenge-progress suppression. Applying Player 1's personal imported
`challengeCompleted` status reduces that to **seven** rows.

An intermediate comparison reported 25 authored-only rows. That historical count preceded fixes for
section and named-area traversal, category-qualified task-source identity, and lower-tier goal
pruning. The seven remaining differences have exact original-worker blockers and are intentional
metadata corrections in the authored evaluator:

| Authored-only rows | Original frontier blocker | Authored interpretation |
| --- | --- | --- |
| Underworld achievements: Damage Without Consequences; Poltergeist Pen Pal | Direct `F2P` blocker at Necromancy 13/20 | The configured trial cap admits Necromancy through level 20. |
| Command Skeleton Warrior ability | Direct `F2P` blocker at Necromancy 20 | The configured trial cap admits the level-20 unlock. |
| Steel mattock | Direct `F2P` blocker on the Archaeology source | The configured Archaeology trial cap admits the source through level 20. |
| Breaking the Seal; Prison Break completion | Their Barracks chain stops at `Clear the ~|fort debris|~ outside Kharid-et`, level 12, with `F2P` | The Archaeology trial rule admits the prerequisite, Barracks area, and declared custodian-page sources. |
| Altar of War furniture plan | Its War's Retreat chain stops at `Get access to ~|War's retreat|~`, Combat 60, with `F2P` | Pseudo-skill Combat is evaluated from combat skills instead of being rejected because it is absent from the original `f2pSkills` list. |

These explain the difference against the retained worker. They verify the authored metadata semantics,
not the underlying in-game facts independently.

## BiS output

The original worker generated 77 eligible BiS candidates. Its captured `activeTasks` cache contains
six concrete BiS rows: amulet of glory, corrupt dragon chainbody, corrupt dragon helm, corrupt dragon
mace, corrupt dragon platelegs, and corrupt dragon spear. The latest authored personal result exposes
483 eligible equipment rows. Its equipment presentation module now creates slot/style recommendations
and alternatives, but the retained original output does not contain enough stable state for a direct
one-for-one recommendation comparison.

## Own and shared authored views

The authored evaluator used the migrated October 6 maps for both members:

| Member | Own available | Shared available | Shared increase | Own bases/sections/areas | Shared bases/sections/areas |
| --- | ---: | ---: | ---: | --- | --- |
| Player 1 / QXA | 1,183 | 1,384 | 201 | 136 / 162 / 68 | 153 / 187 / 84 |
| Player 2 / QXB | 1,362 | 1,429 | 67 | 113 / 156 / 77 | 153 / 190 / 83 |

These totals describe authored eligibility and should not be displayed as active challenge counts.
They show the expected eligibility increase from shared geography. Only Player 1's personal QXA view
has a captured original-worker payload, so Player 2 and both shared
views are useful authored-state checks rather than direct parity evidence.

## Limits

- The comparison uses one fresh original-worker run. The prior audit observed a different first-run
  signature from subsequent warm-worker runs, so exact `globalValids` totals are supporting evidence,
  not a stable golden contract.
- The original payload is QXA-only and predates a direct QXB or shared-access worker capture.
- BiS active rows are supported by the captured `activeTasks` cache because `highestOverall` was not
  retained in this bounded reference output.
- The original worker mutates its input structures and combines eligibility with presentation state.
  The authored engine intentionally separates those concerns; parity must be judged after the selector
  and UI filters are applied.
- `globalValids` category counts are retained in the ignored result for diagnosis. They were not used
  as a substitute for the final skill frontier.

The reproducible ignored scripts are `out/reference-comparison/run-original-worker.mjs` and
`out/reference-comparison/compare-authored.mjs`. Their JSON outputs contain normalized
`category + label` comparisons without copying gameplay state into this document.
