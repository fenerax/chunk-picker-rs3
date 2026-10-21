# H3 / H6 verification — October 12, 2026

The `codex/membership` branch applies Wiki decisions through generated, versioned evidence and guarded loaders. Existing generated catalogues and the original export retain their bytes. Every reviewed decision has a pinned revision in the linked tables.

| Scope | Result | Decisions and implementation |
| --- | --- | --- |
| Five original item disagreements | All resolved; raw cache evidence preserved | [Item table](membership-item-review-2026-10-12.md), [generator](../../scripts/research/membership-item-review.mjs), [loader](../../app/data/item-membership.mjs) |
| 23 original residual selectors | All classified; physical items, historical items and virtual rewards distinguished | [Item table](membership-item-review-2026-10-12.md) |
| Seven additional copied-save selectors | All resolved, including two further documented cache/Wiki exceptions | [Additional decisions](membership-item-review-2026-10-12.md#seven-additional-current-save-labels) |
| All 1,199 Monster labels | 895 prior policies rechecked; 304 former unknowns classified as 214 member, 62 free and 28 mixed families | [Monster table](monster-membership-review-2026-10-12.md), [current revision check](monster-current-membership.2026-10-12.v1.md), [builder](../../scripts/build-monster-membership.2026-10-12.v1.mjs), [source loader](../../app/data/source-membership.mjs) |
| Warriors' Guild mirrors | Base Attack + Strength 130, or either skill 99; temporary boosts rejected | [H6 table](retained-entry-requirements-2026-10-12.md), [generator](../../scripts/research/retained-entry-requirements.mjs), [guarded loader](../../app/data/retained-task-corrections.mjs) |
| Mandrith Combat mirror | Slayer 95 and Combat 120; canonical Slayer mirror unchanged | [H6 table](retained-entry-requirements-2026-10-12.md) |

## Task equivalence and tests

An archived pre-change app and the current app evaluated the same isolated revision-100 copy of the duo save. Both F2P obtainable-item lists now have **zero unknown membership selectors**. Obtainable names changed from 1,627 to 1,608 for Player 1 and from 1,620 to 1,601 for Player 2. F2P-off item counts are unchanged. The broader F2P-off unknown names are outside this F2P review; their exact list remains in the ledger.

No possible task or own obligation appears or disappears in either mode for either player. Player 1's Active list is unchanged. Player 2's Active list regains exactly two already-eligible goals in their respective modes:

| Mode | Exact task | Reason |
| --- | --- | --- |
| F2P | Attack: Wield a gravite melee weapon (`rs3:task:000354`) | The completed composite Guild-entry goal no longer incorrectly proves Attack 65 and suppresses this Attack 55 goal. |
| F2P off | Strength: Complete a lap of the Dorgesh-Kaan agility course grapple route (`rs3:task:001c5a`) | The same correction stops incorrectly proving Strength 65 and suppressing this Strength 60 goal. |

The [published task ledger](membership-task-delta.2026-10-12.v1.md) records the exact comparison, source reductions, capture hashes and matching save hash. Saved progress, completion, History and Undo were not changed.

The six complete prediction fixtures reproduced the old fingerprints against the archived app. Every changed leaf belongs to `coverage.supportedFields`, which gains `RequirementAlternativesDescription` for the short Guild-entry blocker. Task, item, access and prediction outcomes in those fixtures remain identical. Calculation-equivalence and focused membership, variant, provenance, identity, drift, base-level and boost checks pass.

The full `npm test` suite ran once to completion through `.local/with-heavy.ps1`: **2,823 tests; 2,822 passed; 0 failed; 0 cancelled; 1 skipped; 0 todo**. The skip is the existing native skill-PNG byte check when `SKILL_ICON_ASSET_ROOT` is unset. The local log is `.local/membership-full-test.log`.

## Browser evidence and cleanup

The screenshot run used the shared heavy lock, one isolated picker on port 8871 and an owned headless Chrome debugger on port 8873. It waited for both player results and stable, undimmed rows before each capture. All three captures show 28 duo rows: Player 1 25, Player 2 27, shared 24. No browser JavaScript exception occurred. The viewer session reported `readOnly: true`, `canWrite: false`, and all task checkboxes disabled.

| Capture | Size | Local artifact |
| --- | --- | --- |
| Desktop | 1440 × 900 | [.local/screens/membership-desktop-1440.png](../../.local/screens/membership-desktop-1440.png) |
| Phone task panel | 390 × 844 | [.local/screens/membership-phone-390.png](../../.local/screens/membership-phone-390.png) |
| Viewer desktop | 1440 × 900 | [.local/screens/membership-viewer-desktop-1440.png](../../.local/screens/membership-viewer-desktop-1440.png) |

The original save and live port 8788 were untouched. The copied save, temporary viewer store/profile and three raw result captures were deleted. The screenshot server/browser stopped, and ports 8871/8873 have no remaining listener from this job. Screenshots, Wiki snapshots, the test log and synthetic golden comparison remain local-only. No dependencies were added.

Mixed families retain precise-spawn limits; a free intrinsic flag does not waive location, quest or drop restrictions. Historical removed-item membership does not certify current acquisition. Comprehensive obsolete-content cleanup and live game-client validation remain outside this review.
