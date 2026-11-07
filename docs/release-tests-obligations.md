# Release test obligations

Baseline: `01c84c9432e1f7408ed013788445a6c470246439`. Closed #161
(`da0f004`) and #164 (`a3b22fe`) are design/review evidence, not merge inputs.
This inventory precedes the replacement implementation.

| Group | Existing proof that must survive | Replacement boundary |
|---|---|---|
| Transition stages | Upgrade and rollback at before-journal, after-journal, after-binding, after-pointer and during-start, with both caught interruption and hard process exit | Production commit policy with fake stages; native interruption, crash and recovery witnesses |
| Recovery admission | Unknown binding, uncertain runtime owner and failed install verification refuse while paused; ordinary Start refuses a pending journal | Policy refusal matrix plus native owner/Start checks |
| Pending reverse | Rollback from interrupted forward after binding, pointer or start durably records inverse intent and recovers | Fake stage matrix plus native reverse witness |
| Ownership and preservation | Helper and tick locks held during stop/start; foreign runtime unchanged; release references/binding exact; revision-41 save bytes untouched; recovered journal ready; pause cleared only on readiness | Explicit owner/stage acknowledgements and final state assertions |
| Compatibility | Separate packed startups old/new/old/new, release-local pack selection, latest save used, rollback target starts even if replaced code cannot start; changed descriptors/binding/identities refuse; source save untouched | Real Node probe witnesses and JS orchestration over fake probe results |
| Identity additions | Exact new IDs and aliases; missing, extra, duplicate, removed, retargeted or previously authored identities refuse | Existing pure assertions retained |
| Progress | History prefix and types, migration archives/conversions/conflicts, task retention, authoritative progress exact; only latest daily count may recount and later days append | Existing pure assertions retained |
| Entrypoints | Flat-kit imports contained; symlink CLI executes; eval/missing argv import safe; eval/print clusters never treated as main | Existing portable checks retained |
| Early checks | Ordered gallery/startup/pipeline/previous, every failure collected, remaining production budget forwarded, no later work after exhaustion | Existing manual-clock assertions retained |
| Kit staging | Isolated output, all copied payload hashes, extra payload invalidation, existing/overlap refusal, legacy fallback | Existing filesystem assertions retained |
| Prepare and gates | Export exact committed core, exclude untracked/dirty files; own packs; live inherited owner; fresh/reused per-file evidence; normalized PATH; retained rollback after predecessor removal; core mutation refusal | Actual JS orchestrator over fake process/stage boundary, plus native wrapper witness |
| Failed prepare | Nonzero producer cause retained; no release manifest published; release lease closes | Actual JS prepare and native production child-exit handling; a real synthetic producer writes valid outputs then exits 1 |
| Freeze | Two committed cores; accepted retained rollback; forward then reverse dry run exactly once; seal binds retained bytes; post-freeze mutation refuses; current/save/evidence untouched | Actual JS freeze with fake acknowledged dry-run processes |
| Text assembly | Exact private text source retained, packs and scratch excluded | Existing filesystem/CLI proof retained |
| Changed packs | Separate kits/evidence roots; wrapper and digest/timestamp tampering refuse; full lane; new local packs; public core key stable, private/gallery fresh; old packs/save/binding/pointer/evidence unchanged | Actual JS prepare/gate code with fake stages; real packed startup in compatibility group |
| Retention | Both endpoints and unaccepted transition evidence survive later code releases; direct rollback retained; obsolete accepted root pruned | Existing filesystem proof retained |
| Lane environment | Modest heap after sanitization; installed PowerShell resolution; Windows Git longpaths | Existing portable assertions retained |

No case has a test deadline or timing assertion. Completion uses stage results,
acknowledgements and direct process exit. A file may have one diagnostic safety
stop. Production watchdogs/budgets are unchanged. Mutation results and GitHub
old/new timing and 50-attempt receipts belong in the PR body; pending evidence
is not a pass.
