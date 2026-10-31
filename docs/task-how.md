# On-demand planning paths

`GET /api/task-how?memberId=…&taskId=…&revision=…` explains one ordinary
task's current planning decision. It never changes a save. The caller must have
calculator permission: saved viewer links display a notice without starting a
worker. Requests validate the member and revision before calculation and check
the revision and authentication again before returning the proof.

The `how-task` job runs on the existing foreground calculator. It skips collection,
equipment and activity views. It returns only a schema-versioned proof DAG.
Normal task responses, state projections and eligibility-cache bytes contain no
proof fields. A worker-local proof cache retains at most 16 entries / 1 MiB,
keyed by picker, dataset, capability input, revision, member, task and schema.
The scheduler admits at most one distinct pending proof per picker/member.

Settings → Tasks → Show How? defaults on. It uses the existing per-player
`member.preferences.showTaskHow` override and preference command, including
History, backup and Undo. Off renders no disclosure and makes no proof request;
an already-created control also checks the current preference before requesting.

`engine.how` replays the same compiled rule variant and authoritative `check`.
Optional capture records first task admissions, selected item sources, successful
placements and walking entries, and exact primary training seeds. Processing
replays receive fresh evidence. Every exported dependency references earlier
captured evidence; final availability sets are never used to invent a circular
route. AND keeps all children; OR keeps one witness; counted task aliases keep
distinct category-qualified subjects. Effective definition pointers are code
provenance, not independently verified Wiki citations.

Before export, bounded cost propagation selects the successful captured
alternative with the fewest dependent steps, preferring gap-free evidence.
Positive costs start at independent roots; circular alternatives cannot make
themselves cheaper. Changed chains are re-derived after their selected children,
retaining first-admission order separately. The selected area approach follows
that same witness. Once an output budget gap occurs, siblings are marked omitted
without spending further node/depth budget expanding them.

An area permission binds to an entrance only when its selected access-task
chain explicitly requires that exact reachable approach. Nearby candidates and
item source locations cannot supply that binding. Unbound permissions remain
partial. Manual access/level declarations are labelled as assumptions. Training
capability is labelled as a planning assumption at the required level, with the
actual startable seed method and its starting evidence; this is not a complete
XP schedule or verification of repeatability.

Phase 1 covers ordinary own-map walking, areas, task/quest dependencies,
observed levels, completion roots and basic item sources/outputs. Typed travel,
partner supplies, points/XP contributors, boosts, processing, Slayer assignments,
special requirements and unresolved resource-only access produce named gaps.
Generated subjects return `unsupported-subject`; unavailable tasks return a
partial notice. This feature does not explain blocked-task chains.

Output defaults: 512 nodes, depth 32 and 64 KiB UTF-8. Capture is bounded to
50,000 facts/source records and a 20-second replay deadline, shared across
processing restarts. Cancellation is checked between closure passes. Exhaustion
returns `partial` with typed budget gaps; large output collapses to a bounded
gap with no dangling references. The existing worker watchdog remains the hard
deadline for an individual expensive engine operation.

The cave fixture is hand-authored from the requested acceptance model. It tests
independent swamp/rope/light and cellar/quest/training routes, circular roots,
proof/ordinary decision parity, earlier-evidence ordering, distinct aliases,
caps and missing bindings. HTTP and UI fixtures cover revision rejection,
worker state transport, viewer restrictions, cancellation, retry and Advanced
detail. Full-pack timing and exhaustive proof coverage remain release checks.

The player view lists prerequisites before their dependent actions, with the
goal last. Supplies and their selected placements share one instruction;
bound area permissions and their access tasks share one entry instruction.
Quest instructions use the selected definition's description. Display names
come from the current world (including base names for sections); technical
identifiers remain in Advanced detail. Training assumptions remain explicit.
An unbound NPC entry retains its NPC witness and named entrance gap.

An area goal explains its actual captured entry, rather than only the global
permission. A marker containing only `UnlocksArea` does not add a separate
permission requirement to an otherwise witnessed walking entry. A permission
without captured physical access remains partial.
