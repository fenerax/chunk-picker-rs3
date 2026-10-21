# Travel and roll cache boundaries

Automatic travel now reuses the transport-disabled capability proof across
challenge ticks, notes and roll bookkeeping. Ordinary saved task responses use
the same input fingerprint as prepared unlock results. Roll pools still read
the current selection, pending offer and blacklist on every saved revision.

## Automatic travel inputs

`app/core/travel-inputs.mjs` builds a content key on every lookup. It does not
assume callers replace objects: direct callers and previews can edit in place.
Flat global rule keys are sorted. Nested dictionaries and arrays retain save
order: legacy encoded names can collide after decoding, and two saved aliases
can merge into the same task in save order. Backlogs use ordered pairs and
preserve explicit false values and direct callers' explicit undefined values.

The key contains these inputs for **every member**, in roster order:

| Input | Why it is retained |
| --- | --- |
| `id`, `name`, `sourceMapId` | Member lookup, partner/source explanations and legacy personal controls |
| `unlocked` | Personal reachability, partner supplies, training and reachable lodestone activation |
| `sectionOverrides`, `areaOverrides`, `sourceBacklogs` | Entry safety, reachable interiors and allowed supply sources |
| `completedTasks`, `obtainedEquipment` | Actual personal completion can prove prerequisites and finite quest rewards; equipment recorded by hand supplies items even without reachable sources |
| `taskStatus[*].backlogged` | Removing or restoring a task can change production and training; explicit false overrides imported/aliased true |
| `taskRules` | Personal method rules, retained conservatively as complete trees |
| `primaryOverrides`, `passiveLevels`, `maxLevels`, `slayerLock`, `xpChoices` | Training, caps, source restrictions and allocated reward XP |
| `runescapeName`, `skillProgress`, `questProgress` | Account-bound observations, XP, levels and personal quest completion |
| `teleports`, `teleportOverrides`, `transportFacts` | Manual partner connections and explicit levels, quests, item quantities, currency, conditions and confirmations, including false declarations |

The key also retains:

- Global rules except the eight exclusions below. This includes membership,
  sharing, automatic travel, transport access, consumable teleports and skill
  guide variants. Unknown rules invalidate conservatively.
- All global task rules. Even a presentation-looking rule can affect source
  admission; this change does not try to subdivide those rules.
- The complete legacy tree and migration markers. Legacy access, player
  controls, XP allocations and unmigrated personal rules remain valid inputs.
- For each raw personal-completion/backlog ID: its saved aliases and saved-alias
  override, plus entry existence for that ID and every saved candidate. The
  proof resolves these IDs without a category. Its compiled catalogue aliases
  are fixed by the evaluator. Registry entry labels, categories and alias lists
  do not participate in this uncategorized resolution. Unrelated registrations,
  archived records and review metadata do not affect the proof.
- Personally completed saved Quest task IDs and labels. The capability evaluator compiles its own
  catalogue from definitions; saved quest labels additionally prove personally
  completed quest names in the travel fact projection.
- Caller-supplied `transportFactsByMember`.

World definitions, topology, catalogue, dataset and engine options are scoped
to the configured world/evaluator. Reconfiguring it or releasing idle caches
discards the results. A shared evaluator keeps at most two baseline signatures
and one result per member per signature; each world retains one derived
signature. The retained/component world projections share the proof but retain
their own location projections.

## Excluded changes

| Change | Why automatic capabilities do not change |
| --- | --- |
| Challenge tick or untick | `challengeCompleted` satisfies the challenge; it does not prove an in-game quest, item, recipe or level |
| Favorite, task note or backlog reason | These describe an objective; only the actual `backlogged` flag gates a method |
| Selected candidates, pending roll, never-roll marks | These control offers and exclusions, without changing owned chunks or personal travel facts |
| Revision, history, claims, progress snapshots | Save coordination and historical records do not supply capabilities |
| Notes, journal, preferences, stickers, colours and colour names | Display/planning data are not consumed by the conservative evaluator or travel fact projection |
| Saved F2P map | The proof uses current ownership, not the archived starting map |
| Sync summaries | The actual account-bound skill/quest records and source declarations are keyed; sync bookkeeping is not evidence |
| Finish Line, group goals and rule reviews | Planning targets and review records do not supply capabilities |
| Non-Quest saved task metadata | The evaluator compiles definitions; the separate saved-label travel projection reads only Quest IDs and labels |
| Uncompleted saved Quest labels | A first challenge tick can register a Quest row; the personal quest projection reads its label only after actual personal completion |
| Task alternatives and registry review/display metadata | These select presented goals or describe identities; the conservative proof evaluates every production method and reads only identity-resolution fields |
| `roll.selected`, `roll.adjacent`, `roll.neighborMode`, `roll.clearSelected`, `roll.walkable`, `roll.teleports`, `roll.teleportScope` | These select/filter roll candidates; the conservative task proof does not use the roll pool |
| `tasks.completion` | This changes challenge satisfaction flags, which travel does not consume |

`roll.consumableTeleports` is deliberately retained: even with typed automatic
transport disabled, manual consumable teleports can change partner connections.
All task rules and legacy records remain conservative invalidators, so some
irrelevant edits to those trees can still miss the cache.

## Saved task results

`createTaskReuseFingerprint` remains the shared boundary for ordinary saved
results and unlock prediction promotion. It excludes revision/history,
provenance, claims, progress snapshots, Finish Line, group goals, rule reviews,
member selections, pending offers, blacklists, preferences, journal and colours.
Every other task input remains keyed, including all task status fields and
actual personal completion. A single-choice roll unlocks immediately and still
invalidates; only an offer without changed ownership reuses tasks.

The server rebinds completed response bytes and worker caches to the new HTTP
revision. Revision-checked writes, stale Group read rejection, stream revision
events, claim cleanup and prediction signatures remain active. Pool eligibility
is calculated from current state independently of task-response reuse. Pool
ranking reads also receive the current eligible IDs.

## Equivalence checks

The public synthetic transport fixture compares cached routes, roll pools and
complete engine results with released travel caches and a fresh task engine
after 17 sequential edits: first generated-task registration/tick, first Quest registration/tick, tick, untick, task note, membership rule, task
capability rule, roll rule, offer, unlock, pool selection, blacklist, lodestone
override, lodestone confirmation, quest sync, level sync and task backlog.
Only elapsed-time diagnostics are removed from the deep comparison.

Additional tests check hit/miss counts, both members' capability inputs,
external facts, legacy controls, identity changes, replaced task arrays,
in-place edits, object-key ordering and alias backlog order. The server test
checks both Group lists across revision-checked rolls/cancellation/pool edits,
current pool exclusions, stale reads/writes and a subsequent unlock. Both test
files run in the quick lane. Existing unlock promotion tests cover the shared
fingerprint's prepared owner and partner projections.

## Measurements

Windows, Node 24.20.0, the same copied members save and companion release,
seed 1729, and the shared heavy-work lock. Each command measurement includes
the durable save and two parallel Group task reads. Unlock followed the roll
immediately, without waiting for prediction warming. These are single trials.

| Action | Before wall s | After wall s | Before save s | After save s |
| --- | ---: | ---: | ---: | ---: |
| Task tick | 7.160 | 3.958 | 3.953 | 0.391 |
| Task capability rule | 8.553 | 6.981 | 5.046 | 4.068 |
| Two-choice roll | 7.147 | 0.461 | 4.056 | 0.404 |
| Immediate unlock | 7.116 | 6.821 | 3.959 | 3.422 |

The tick took 45% less time; the roll took 94% less time. The roll dispatched
zero task evaluations, compared with two before. Tick and unlock still
evaluated both members. Unlock still needs a genuine travel rebuild, so its
smaller timing difference should not be treated as a reliable algorithmic gain.
The task rule also changes capabilities and remains a cache miss.

Both members' normalized task-response hashes matched before/after at all five
primary phases (startup, tick, rule, roll and unlock). Only revision, cache and
timing metadata were removed. Save, companion and Node input pins matched too.
An earlier tick trial overlapped focused verification and was discarded; the
table uses a fresh baseline run without that overlap.

`scripts/perf/map-growth.mjs --full --repeat 1 --max-worker-mib 1500` used the
verified walking frontier and the same input/dataset digests on both versions.

| Owned chunks | Before evaluation s | After evaluation s | Before pool s | After pool s |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 3.199 | 5.469 | 4.389 | 5.736 |
| 10 | 2.583 | 3.289 | 2.109 | 2.272 |
| 40 | 1.560 | 2.316 | 1.429 | 1.277 |

Task, presented-task, available-task and eligible-roll counts matched at every
checkpoint. Both walks exhausted the same 40-chunk component. Worker peaks
stayed below 1,050 MiB. Larger/grid stress scenarios were not rerun. Cold
evaluations were slower in the final after trial. These single samples do not
establish why; they provide no evidence of a cold-evaluation speedup. These
changes skip work when inputs are unchanged and do not reduce the engine's
calculation complexity.

The single full suite found an extra metadata capture and an obsolete assertion
that cancellation must discard predictions. The metadata lookup was repaired
and the assertion now verifies preservation at the new revision. Focused reruns
including the affected server, transport and unlock-reuse tests passed all 108 tests. The full suite
was not repeated, following the one-full-run limit.
