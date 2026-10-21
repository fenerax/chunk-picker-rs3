# Membership follow-up: exact copied-player task changes

This compares the same isolated copied save before and after H3/H6. The baseline uses an archived pre-change app; both captures use identical definitions, saved facts and cache inputs. The live picker and original save were not opened by the audit.

| Player | Mode | Possible before → after | Own before → after | Active before → after | Obtainable names before → after | Unknown names after |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Player 1 | F2P | 1681 → 1681 | 1650 → 1650 | 25 → 25 | 1627 → 1608 | 0 |
| Player 1 | F2P off | 5417 → 5417 | 5352 → 5352 | 312 → 312 | 4486 → 4486 | 247 |
| Player 2 | F2P | 1673 → 1673 | 1626 → 1626 | 26 → 27 | 1620 → 1601 | 0 |
| Player 2 | F2P off | 5451 → 5451 | 4959 → 4959 | 284 → 285 | 4507 → 4507 | 257 |

## Every task appearing or disappearing

Possible tasks include partner-supported capability rows. Own obligations and the normal Active Tasks list are reported separately below. No count substitutes for the exact task-ID comparison.

| Player | Mode | Change | Category | Exact task | Own obligation | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| Both | Both | None | — | No possible task appears or disappears. | — | Eligibility remains unchanged in this copied save. |

## Own obligation and Active Tasks changes

| Player | Mode | Scope | Change | Exact task |
| --- | --- | --- | --- | --- |
| Player 2 | F2P | Active | Appears | Attack: Wield a gravite melee weapon (rs3:task:000354) |
| Player 2 | F2P off | Active | Appears | Strength: Complete a lap of the Dorgesh-Kaan agility course grapple route (rs3:task:001c5a) |

Player 2's completed shared Guild-entry objective previously counted as satisfied Attack 65 and Strength 65. Entry may instead be earned through an uneven combined level or mastery in either skill. The corrected composite entry goal no longer proves either standalone skill level. This removes an invalid presentation suppression: the gravite melee-weapon goal (Attack 55) reappears in F2P, and the Dorgesh-Kaan grapple-course goal (Strength 60) reappears with F2P off. Both were already available before; item access and reachable training are unchanged. The JSON ledger identifies any further eligibility changes independently.

## Evidence and verification

Copied save revision: 100. Exact save SHA-256: `c5f3a5744238d2f9d43355c3e49b40109823c9221d1419ee0611f25e1f14928d`.

Before capture SHA-256: `a0b1108151545f57d3d28fadcbf53b533a05dd15a026f45fc455de94f2ca7c26`. After capture SHA-256: `5a9f4a572eb8acfda6bbd8f52fc44d0b27859dedbac6c7aef1471b0238e24024`.

The matching JSON ledger records the complete before/after app hashes, source reductions, all task IDs, after blockers and remaining unknown selector names. Raw copied-save and result files are local-only and deleted after verification. Saved completion, player progress, History and Undo are unchanged.

The six prediction goldens were compared as complete objects against the archived app. Their only change is the supported-field list gaining RequirementAlternativesDescription; task, item, access and prediction outcomes in those fixtures are identical. Calculation-equivalence and focused membership/entry checks pass. Full-suite and browser counts are reported in the final verification note.

Decisions: [items and virtual selectors](membership-item-review-2026-10-12.md), [all monsters](monster-membership-review-2026-10-12.md), [H6 entry requirements](retained-entry-requirements-2026-10-12.md). Mixed family classification does not certify a precise spawn or waive existing location/quest restrictions. Historical item membership does not certify current acquisition.

Reproduce with isolated capture files: `node scripts/audit-membership-followup.mjs`. This script never reads a live store.
