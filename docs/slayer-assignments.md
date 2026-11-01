# Slayer assignment chances

Activity Info → Slayer lists each master's assignments and targets. “Possible”
means a way exists in your chunks, including after training or completing other
available activities. An available unfinished quest satisfies a planning unlock;
the assignment says “after” that quest. Another player's completion does not
establish your personal completion.

Each reachable ordinary master has a planning warning when its unlocked pool
contains assignments without reachable targets. It names those assignments and
rounds their combined weight to a friendly fraction, such as “about 1 in 4”.
The denominator includes only assignments whose unlock requirements are met in
planning. Unreachable masters have no warning. Death's Soul Reaper assignments
have different rules and are excluded.

“Right now” uses personally completed quest requirements and observed current
Slayer and Combat levels. Observations retain their engine-validated source
(game plugin, RuneMetrics, official API or hiscores). A saved Slayer lock's
reported level can supply Slayer when no observation exists. Combat is derived
only when all relevant combat skills are observed; planning ceilings, passive
training settings and level limits never supply missing current levels. Without
current levels the panel says “Sync your levels to see your chances right now.”

Target checks follow serialized monster locations, source task gates, area
unlock tasks, quest-gated sections and entrance gates. An unfinished quest blocks
that route right now; another independently usable target can still qualify.
The lower [Lumbridge Catacombs](https://runescape.wiki/w/Lumbridge_Catacombs)
requires personal completion of The Blood Pact, even though the retained area
record admits its quest entrance earlier. Missing, cyclic, unsupported or overly
long route proofs go into a separate “can't tell” weight, never the doable pool.
These are bounded display checks, not a complete current-inventory or combat
simulation. No stuck line appears for a known zero chance. Empty or zero-weight
pools and missing weights show “weights are unknown” without a fraction.

Advanced mode shows exact stuck and unknown weights over the pool weight, plus
the stuck percentage. These calculations use the declared master tables; saved
in-game blocks, preferences, point balances, streaks and special assignment
selection rules are not modelled. They are not a proof that Slayer training is
sustainable. [Cancelling costs 30 Slayer points, and points start at the fifth
task](https://runescape.wiki/w/Slayer_points).
[Turael](https://runescape.wiki/w/Turael) replaces another master's assignment
only when he would not assign that creature himself.

The six weights reviewed on 2026-10-31 are guarded corrections in
`app/data/reference-corrections.2026-10-31.v1.mjs`, leaving archived export bytes
unchanged. Sources: [Mazchna](https://runescape.wiki/w/Slayer_assignment/Mazchna)
(Sanguine crawlers 15), [Sumona](https://runescape.wiki/w/Slayer_assignment/Sumona)
(Profane Scabarites 15), [Kuradal](https://runescape.wiki/w/Slayer_assignment/Kuradal)
(10), [Morvran](https://runescape.wiki/w/Slayer_assignment/Morvran) (12), and
[Laniakea](https://runescape.wiki/w/Slayer_assignment/Laniakea) (12; Undead 4).

The assignment tables are read by this display, not the planning engine. These
warnings and weight repairs do not change engine task results or training.
