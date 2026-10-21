# Reviewed source overlays

Dataset profiles can select `catalogue.definitionOverlays`, a list of versioned
JSON inputs also present in `catalogue.inputs`. This keeps corrections out of the
original export and binds the selected inputs to the dataset digest. Profiles
without this list keep their existing behaviour. Browser metadata carries the
same selection as the server and worker.

Full provider loads apply selected overlays before server publication, and
workers inherit the completed preparation stages. Synthetic engine definitions
without a provider and explicitly injected server definitions opt out through
`reviewedOverlays: false`; a provider-backed fixture can choose that same option.
This is an explicit source boundary, never a missing-target heuristic. Selected
production inputs still reject missing targets and drift.

An overlay has `schemaVersion: 1`, `id`, `version`, optional `guards`, and
`patches`. Guards identify an exact path and SHA-256 of its JSON value. Each patch
names a path and the complete before and after record, with explicit presence
booleans and a `beforeRecordSha256` for an existing record. An insertion requires
absence. Application copies changed branches, preserves task identities, accepts
an already applied result, and throws on drift. Source insertions should also
guard the exact source declarations they depend on. Review evidence belongs in
the dataset input; engine modules contain no dataset-specific records.

`retainedTaskCorrections` in an overlay selects successor correction inputs for
the existing field correction schema. Selected additional corrections use strict
drift checks. `bankingServices` contains exact reviewed physical variants; it
does not expand a surface-wide bank allowlist. Fish-only deposits are eligible
only for Fishing routes, never withdrawals or wood/ore banking. Quest entry may
use a documented personal completion alternative; ownership alone is insufficient.

## Source records

Ordinary harvests use existing `Objects` and `Output` requirements, without a
Farming level, seed, XP or primary-training declaration. `SourceLocations` binds
the admitted object or NPC to its reviewed location, preventing a same-name
quest object elsewhere from substituting for it:

```json
{"Objects":["Wild plant"],"SourceLocations":[{"field":"Objects","name":"Wild plant","locations":["reviewed-location"]}],"Output":"Produce"}
```

Each selector is required. Supported kinds are `Objects`, `NPCs`, `Shops` and
`Monsters`; location matching uses exact admitted provenance. A recorded task
completion does not bypass this source restriction.
The same scope limits personal obligation, source explanations and map indexing.

`DialogueSupply` is deliberately a **closure-only adapter**. It requires an
admitted NPC and a reachable source for every item in at least one payment
alternative. It exposes exact quantities but never asserts the held balance,
deducts payment, or claims an observed purchase. A completed purchase cannot
bypass the payment/source checks on future supply.

```json
{"NPCs":["Supplier"],"Output":"Supply","DialogueSupply":{"mode":"closure-only","paymentAlternatives":[{"Coins":15},{"Wool":4}]}}
```

The resulting source retains the payment alternatives, `balanceVerified: false`
and repeatable potential-supply provenance. No wallet or inventory state was
added. Paid stock counts and quantities must not be interpreted as owned items.

`FiniteRewards` lists `{item, quantity}` entries on a completion record. The
record cannot also publish ordinary `Output` or `Reward`, including table roots.
This prevents indirect publication of a finite reward as repeatable supplies. The
engine exposes these on the task and in `result.finiteRewards` with one of
`completion-blocked`, `attainable-on-completion`, or `completion-recorded`.
`claimStatus` is `untracked` and `remainingQuantity` is `null`. Rewards never enter
ordinary item closure, equipment or repeatable training. An independent source
of the same item remains valid. This conservative preview avoids pretending
that completion proves an unspent stack; claim and consumption tracking remain
outside this adapter.

`PersonalRequirementAlternatives` accepts a quest title or a permanent
`completedTask` ID per clause. One clause must have recorded personal evidence.
Available tasks, partner completion and challenge-only checkmarks do not count.
Existing revision-checked completion commands record manual entry observations;
the overlay must provide a visible, clearly described confirmation task.

## Deferred context work

Member instances require a separate identity review and an inventory-domain
boundary before their shops and processing facilities can enter ordinary-world
closure. New Varrock uses a distinct currency and equipment context. A blanket
name match or a membership flag alone would leave that problem unresolved.
Vinesweeper and Temple Knight entry likewise need exact reviewed identities and
entry evidence. Their corrections are deferred as a single reviewed follow-up,
rather than mixing a partial identity patch into the source adapters above.

Croc ice needs a recorded “during or after Crocodile Tears” stage and its special
auto-consumed, unbankable behaviour. A whole-quest-only requirement would suppress
a valid during-quest source; a reachable quest task would grant it too early.
Add a generic revision-checked personal stage observation with History/Undo,
then a source-specific stage predicate and a non-carried consumable channel.
Do not put it into ordinary renewable inventory closure meanwhile. The existing
incorrect source is recorded as unresolved, not silently reclassified as fixed.

Genie's Cave light preparation remains a separate review. Removing its obsolete
rope requirement does not settle the game's warning or darkness behaviour.

Evidence: [New Varrock, revision 37187626](https://runescape.wiki/w/New_Varrock?oldid=37187626),
[Vinesweeper, revision 37146867](https://runescape.wiki/w/Vinesweeper?oldid=37146867),
[Recruitment Drive, revision 37182740](https://runescape.wiki/w/Recruitment_Drive?oldid=37182740),
[Croc ice, revision 36252300](https://runescape.wiki/w/Croc_ice?oldid=36252300), and
[Crevice (Genie's Cave), revision 36341662](https://runescape.wiki/w/Crevice_(Genie%27s_Cave)?oldid=36341662).
