# Product scope

Confirmed with Player 1 on October 7, 2026.

## Purpose

Recreate the RS3 Chunk Picker from scratch, one for one as closely as practical. Preserve its recognizable map workflow and useful feature breadth, then add Group Ironman and special-rule support. A small duo-only substitute is not the final scope.

The first users are Player 1 and Player 2. Public multi-user use remains the destination; the initial duo deployment does not limit the product to two people. Keep each player's maps and progress separate while supporting shared groups. [Sharing](docs/sharing.md) documents invitations; deployment-specific setup belongs to the operator's private runbook.

## Required outcomes

- Match map navigation, chunk states, rolling, task views, search, quest/achievement tracking, equipment/BiS views, drops, notes, filters, history, sandbox and settings wherever practical. Track each feature against the reference rather than treating a matching screenshot as completion.
- Preserve both existing maps, ownership, saved candidate pools, house rules, notes, backlogs, and task checks during migration. Show a preview and retain the original records when a mapping is unresolved.
- Support individual maps and a combined group view. Shared access, task completion, and supplies are separate policies.
- Make new rules easy to add through a documented registry, with validation, descriptions, explanations, and meaningful tests. Eventually support editable profiles and declarative overrides without editing engine code.
- Make interactions and calculations substantially faster. Establish measured budgets and compare equivalent results and inputs. Index definitions once, avoid whole-world redraws and repeated eligibility work, and update affected computations only.
- Explain why a chunk can be rolled and why a task is available or blocked. Show the rule, personal requirement, source, or access restriction responsible.
- Provide reliable saves, full backups, restore preview, roll history, undo, conflict handling, and recovery from failed loads or computations.

## Confirmed duo semantics

Player 1's account is `exampleGIMab`, map QXA. Player 2's account is `twosamplegim`, map QXB.

- Once the players met, they could access each other's unlocked tiles. Ownership stays individual.
- Access to the partner's chunks is for convenience only, confirmed October 7: a player may use the partner's connected chunks to train, gather and buy, for example a better smithing spot or higher ores, but the partner's chunk tasks never become that player's obligations. A player's own tasks come from their own chunks.
- The partner's chunks count as connected only when the player can get there and back, confirmed October 7. Any legitimate route counts, such as walking through either player's unlocked chunks, a teleport the player can use, or a lodestone in an unlocked chunk, but never walking on unclaimed chunks. A one-way route, such as a teleport in with no way home, does not connect.
- Either player can satisfy a chunk requirement for the duo. Actual quests, quest points, achievements, rewards, skills, and teleport availability remain personal.
- Supplies may be shared through trading or the group bank.
- The duo stays F2P until finishing its F2P content. The exact completion checklist is not yet defined, so membership progression must remain explicit.
- Lodestone travel between unlocked chunks is allowed.
- A usable teleport makes its destination eligible for a future roll. It does not unlock that destination or grant access to its resources before it is rolled.
- Teleport eligibility applies only to the player who can use that teleport, confirmed October 7. Availability starts as manually confirmed; automated verification is a later feature.
- Each player rolls on their own map. Rolling a chunk the partner already owns is a valid roll, not a wasted one: because the two maps differ in shape, it can still change what that player can reach and roll next. This has happened in play (confirmed October 7). A pending offer therefore stays valid when the partner unlocks one of its chunks. A player's roll candidates come from their own map only: chunks next to the partner's tiles do not widen them (confirmed October 7).
- A walking candidate qualifies if even one tile is reachable on foot from an adjacent personally unlocked component. Orthogonal adjacency alone is insufficient, and walking never crosses an unclaimed chunk. A free roll requires a free qualifying component. Cache-derived walking geometry implements this rule without a minimum land-area threshold.
- Two group modes are wanted, confirmed October 7: separate personal maps with a combined map and task view of everything either player can walk (the current model), and a single shared map, which differs from one player's map mainly in who does which grinds. The shared-map mode is not yet designed.

Consumable teleports and any broader underground-access exception remain unconfirmed. The initial consumable-teleport setting defaults off and is configurable. Do not infer new house rules from game mechanics or saved picker settings.

## Parity and corrections

The October 6 audit identified duplicate task IDs, incorrect F2P restrictions, dangling connections, save conflicts, and a Roll 2 edge case. Recreate the intended behavior, with documented corrections to defects. Never reproduce a destructive bug solely for parity.

The upstream reference is version 6.9.68, commit `98a3bdc5e0992616ca52c8d2429e7ef2f4fdd8f0`. It contains the reference implementation and data; all new executable code is written under `app/`. Adapters keep imported data distinct from the authored implementation.

Player 1 confirmed on October 8 that coupled loadout BiS scoring stays, including the Rune arrow pairing. Tasks also keep their canonical skill headings and appear once; the original picker's additional skill mirrors are deliberate display differences.

## Delivery checkpoints

1. Rules and state foundation: test the confirmed group rules, preserve imported records, validate backups, and measure roll evaluation. This checkpoint has a command-line inspection surface, not a replacement website.
2. Map workflow: faithful browser layout, map layers and navigation, existing state semantics, candidate controls, normal/random/two-choice rolling, history/undo, notes, and accessible keyboard controls. Compare both real captured maps and reference workflows.
3. Task-engine parity: validated section/interior access, requirements and item-source graphs, training methods, quests, achievements, drops, equipment, and rule profiles. Compare canonical results against captured reference outputs; record justified differences.
4. Migration and sharing: complete category-aware task-ID conversion, restore/merge preview, durable local storage, and representative two-user conflict and recovery tests.
5. Full parity and speed acceptance: finish the checklist, verify mobile/desktop workflows, benchmark cold startup and full/incremental task computation, and document every remaining limitation.

Checkpoints sequence work; they do not narrow the final feature scope.

## Sharing and accounts (direction, updated 2026-11-05)

- Retain accounts, sign-in and multi-picker support. One picker account should support several RuneScape accounts, each with its own map, tasks and sync, plus group views and friends' maps. Avoid hard-coding exactly two members.
- Keep the existing Discord and Google sign-in. WorkOS is not selected; reconsider it only for a concrete unmet login/recovery need.
- Keep the Node/file-store architecture unless measurements justify a different engine or storage design. Isolate per-picker state and share bounded calculation resources.
- The official-game plugin supplies observations. In live play, automatic ticks are the intended default with easy Undo; beta observations remain unable to tick live progress. Requiring confirmation for every live tick is not the product direction.

## Capacity and groups (2026-11-08)

- Design target: about 2,000 player characters in 500–1,000 groups, up to about 200 people online at once, on one server, with immutable game data stored once. Prove this ceiling on disposable hardware before raising admission caps beyond the population already proven.
- Groups hold 1–5 characters. First sign-in creates a picker; its owner invites friends by link.
- One Discord or Google login holds up to 10 RuneScape characters, each in exactly one group, with one switcher between their maps. Several of a login's characters may share a group.
- A character that changes group takes on the destination's map; its previous map stays as a read-only past map, never merged or deleted.
- [Groups and accounts](docs/groups-and-accounts.md) is the full contract.

### Staged beta (owner decision, 2026-11-11)

Open a capped, invite-only beta of roughly 25–50 groups once the [launch basics](docs/launch-readiness.md) pass, within a load-tested envelope of about 100 active groups. The 2,000-player design ceiling remains a later proof obligation before caps rise beyond demonstrated capacity. This replaces the requirement to prove 2,000 players before any public launch. Public sign-up itself still requires the owner's explicit OK. This decision does not deploy changes or enable sign-up.

## Sources of decisions

- This chat: full recreation, from scratch, GIM/special rules, extensibility and speed; personal teleport eligibility.
- Previous chat `01a1130a-4982-7e81-87f7-4c1fdc32f234`, “Find RS3 chunk picker source”: destination eligible to roll, private standalone use, earlier audit and feature proposals.
- Planning notes (kept outside the repository), October 4: confirmed duo access/completion/supply/travel rules. Its account and map counts are dated snapshots, not current progress.
- Local October 6 audit under `C:/Users/User/Projects/personal assistant/out/rs3-chunk-picker-audit-2026-10-06/`: measured defects, captured public gameplay data, and reference timings. Use its newer fixture for technical comparisons without claiming current gameplay state.

## Switch-over decisions (2026-10-08)

Player 1 and Player 2 plan to replace the original chunk picker with this app once the parity blockers in `docs/research/switchover-parity-2026-10-08.md` are fixed and re-checked. Decided differences from the original, which parity checks treat as intended:

- **Best in Slot scores loadouts.** Weapon, off-hand and ammunition are ranked together (a bow with the arrows it fires), not slot by slot as in the original. Extra Ranged goals and Rune arrows as an Acadia longbow pairing follow from this.
- **Each task is listed once.** A task that trains several skills appears under its main skill instead of being copied under every skill heading; completing it still counts once.
- **Members-only content is excluded for the F2P duo** by item, source and method evidence (see `docs/research/f2p-membership-audit.2026-10-08.v1.md`); a "held but unobtainable item" supply rule is not needed for Ironmen finishing F2P first.
- **Chunk Rules mirrors the original's structure** (sections, descriptions, parent/child rules, presets), with honest markers on rules that are saved but not yet active.

## Public product decisions — 2026-11-05

The picker is intended to compete with the original RS3 picker: fast updates and task loading, correct F2P access and boundaries, clear reasons, easy error correction, multiple individual maps and groups, and a companion game plugin. A report that something looks wrong should eventually feed an automatic evidence check.

Save portability must work between instances of this picker and in both directions with the original. For original-picker import, a map code read in the player's browser is the main route; pasted chunks and rules are the fallback. Handle source reads in the browser, with explicit preview and confirmation before changing local progress. Check the current transfer implementation rather than rebuilding completed phases.

Map first is the permanent layout direction, including the phone home view; display names should occupy about 20 characters. Code restructuring is allowed when it improves speed, responsiveness and usability. Evaluate design iterations against frozen comparison references with overflow, map-share, contrast and viewport checks before reviewer scoring; reviewers must not be told a target score.

Every available task should have a real, explainable route. Preserve full prerequisite alternatives in Why not? and plain-language How? evidence; verify routes against source evidence and turn demonstrated errors into regression cases.

Development priority remains speed/performance, then usability, then accuracy. The update target is 15–20 minutes end to end, with new gates charged against that budget. Usability ideas from 2026-11-02 remain proposals: remove internal IDs, repeated steps and jargon from How?; decide inline versus popup presentation; consider a backlog reason dialog, modifier-click quick backlog, and forwarding “task is wrong” reasons to feedback. These ideas are not an implementation grant.
