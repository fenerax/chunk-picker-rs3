# Cache access comparison

The comparison reads an explicitly supplied temporary copy of a private state without starting a server, importing, migrating, or writing that state. Outputs must be distinct files under this worktree's ignored `.local/` directory. Do not commit these derived gameplay reports or a private input.

```powershell
node scripts/compare-cache-access.mjs --state TEMP_PRIVATE_COPY --output .local/cacheapply/comparison-v2.json --cache-walking both
node scripts/report-cache-access-diff.mjs .local/cacheapply/comparison-v2.json .local/cacheapply/access-differences-v2.md
```

Create and delete the temporary private copy outside those commands, using `try/finally` so cleanup also happens on a failed comparison. The comparison verifies the input bytes remain unchanged. Both modes run against the same state and definitions in one process. For separate snapshots, use `--cache-walking false` and `--cache-walking true`, then pass `BEFORE.json AFTER.json OUTPUT.md` to the reporting script. Omission of the mode means `both`.

The baseline is the current corrected retained world and task engine with cache walking explicitly disabled. It retains current source corrections, rules, saved overrides and presentation behavior; it is not a historical checkout. The after calculation explicitly enables cache walking. Definition hashes and input hashes must match. Reporting also checks the current cache policy/component topology against the after snapshot, so changes during review require fresh snapshots.

Schema 2 contains an anonymous `Member1`, `Member2`, etc. for each member. Each snapshot includes roll eligibility and excluded reasons, reachable travel sections, the engine's partner connections used by the browser and separate roll-rule partner connections, own obligation access and combined capability access, source presence and location lists, physical components and compatibility resource sections, entrance provenance, spawn quantities, quest-step locations and clue counts, task blockers/sources/requirements/display suppression, server available task count, browser task views, diagnostics, and Activity Info training ceilings and methods. It omits raw save fields, names, account observations, notes and history. Derived gameplay reports still belong in ignored storage.

The calculation follows the production worker's collection/equipment/presentation sequence, including preserved saved derived rows. A focused test compares this calculation to the real worker. Browser views execute the actual `renderTasks` function from `app/web/main.mjs` in a DOM-free VM harness with production task-fact helpers. The default view uses saved `hideChecked`, empty search, Show blocked off and All possible tasks off. Additional views change only hide completed, Show blocked, or All possible tasks. Counts include rows behind the UI's Show more control. Activity Info uses its production builder. This verifies calculation and visibility logic, not a live browser session.

The Markdown report enumerates every change without an example cap, including lost locations for sources that remain present elsewhere. It records complete task source additions/removals and links changed items to deduplicated location/source evidence. The JSON retains full before/after task source proofs. Cache evidence includes correspondence candidates, membership counts, reached components, incoming boundary witnesses, compatibility classification, retained interior entrances and relevant diagnostics. A missing direct geographic requirement is reported as such; the report does not invent a boundary cause for an indirect task change.

An application loss requires investigation even when geometry is unresolved. An unresolved selector is not proof of an in-game loss. Compare task blockers, gates, membership and cache witnesses individually; resource-only compatibility does not grant a walking origin or a roll candidate.

Focused validation:

```powershell
node --test tests/cache-comparison.test.mjs
```
