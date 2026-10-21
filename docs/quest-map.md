# Quest chunks on the map

In a Quest task's details, choose **Show on map**. The same control is inside
each expanded quest in **Activity Info → Quests**. The dialog closes and the map
fits the recorded surface chunks, or centres on the first if the route is too
wide for the map's minimum zoom. A small panel shows the quest name and a count,
such as “5 chunks · 2 still locked”. **Clear** removes the highlight.

Solid pink outlines mark chunks unlocked by either player; dashed amber outlines
mark chunks neither player has unlocked. Ownership does not guarantee a connected
route or that every quest requirement is met. Showing another quest replaces the
selection. Opening Search, switching players or adopting a new save revision also
clears it. The controls work on view-only links and never change the save.

Locations come from the retained quest route, every recorded step's chunk
selectors and recursively listed task subrequirements, including prerequisite
quests. Section IDs use their surface base chunk. All locations in a recorded
alternative are shown, with a note that only some may be needed. Item sources,
prose and interior entrances are not used to infer missing chunks. Named interiors
are listed as having no surface square. Steps or selectors with no recorded
chunk are named plainly. If no surface chunks are recorded, the dialog stays open
with that explanation.

`quest-map-model.mjs` resolves recorded locations; `quest-map.mjs` owns the
temporary selection and controls. It reuses `map-search-layer.mjs` through
`map.setSearchMatches`, and `map.centerOnChunks` uses the existing bounds fit.
Focused tests cover collection, aliases, cycles, missing data, ownership, clearing,
late responses, view-only controls and the task/Activity Info hooks. The copied-save
browser check runs through `.local/with-heavy.ps1 node scripts/review-questmap.mjs`
on ports 8951/8952 and writes its report and 1440px/390px captures under
`.local/screens`.
