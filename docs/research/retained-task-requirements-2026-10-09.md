# Retained task requirement audit — 2026-10-09

The War's Retreat access task (`rs3:task:0003c5`, Combat, chunk `12339`) omitted a valid entry alternative. Current entry requires **Combat 60 OR total skill level 1,000**. Combat 60 is an actual entry option. [War's Retreat revision 37178109](https://runescape.wiki/w/Special:PermanentLink/37178109) records both alternatives and the October 2021 change that added total level.

The separate **War's Retreat Teleport** requires **10 total boss kills** and unlocking the spell from War's Wares. Repeated kills of one boss count; there is no five-different-boss requirement. The spell has no Magic level or rune cost. Boss kills are a threshold and are not consumed. [Teleport revision 37177732](https://runescape.wiki/w/Special:PermanentLink/37177732), [War's Wares revision 37136616](https://runescape.wiki/w/Special:PermanentLink/37136616) and [stock revision 37173876](https://runescape.wiki/w/Special:PermanentLink/37173876) independently identify that unlock. An entry task does not grant personal teleport usability.

The new exact-record overlay replaces `Level:60` with neutral `Level:1` and adds `RequirementAlternatives:[{Skills:{Combat:60}},{TotalLevelNeeded:1000}]`. Its description explains entry and teleport separately. The raw task label, stable ID, chunk, primary flag and priority stay unchanged. The original export and previous versioned evidence remain untouched. A custom record that differs in any reviewed or authored field is preserved; strict auditing reports drift. The overlay is idempotent.

## Recommendation audit

The retained export contains **20,375 task rows** and **12,796 numeric level/skill requirement fields**. The textual sweep checked every row for recommendation wording. Independent current Wiki evidence checks every **41 numeric Combat-gated rows** across Combat, Slayer, Defence, Strength and Diary, plus the two Warriors' Guild entry tasks. The versioned [evidence bundle](../../app/data/retained-task-corrections.2026-10-09.v1.json) records every audited task ID, retained gate, decision and 31 pinned Wiki pages with content hashes.

No confirmed case of a recommended level being mistaken for a hard requirement was found in this bounded evidence audit. That conclusion does not certify every numeric requirement in the whole catalogue.

Two retained rows contain recommendation wording:

| Task | Decision and evidence |
| --- | --- |
| `rs3:task:0036c3`, On the Warpath | Preserve Combat 60. The achievement's objective is reaching Combat 60 even though its description calls that level the recommended route to War's Retreat. [Revision 36637012](https://runescape.wiki/w/Special:PermanentLink/36637012) |
| `rs3:task:0049a1`, desert clue mentioning Ali's recommendation | Preserve. The wording is clue text and the task has no numeric level or skill gate. |

Other reviewed Combat gates are genuine equipment, assignment, reward or achievement thresholds. Examples include the black mask's Combat 40, Soul Reaper's current Combat 50 and Slayer 45, and Supply and Demand's Combat 18 for the fifth supply run. [Black mask revision 37132895](https://runescape.wiki/w/Special:PermanentLink/37132895), [Soul Reaper revision 37197815](https://runescape.wiki/w/Special:PermanentLink/37197815), [Supply and Demand revision 36810815](https://runescape.wiki/w/Special:PermanentLink/36810815). Turael and Jacquelyn's retained Combat 3 equals the account minimum rather than a further unlock. Jacquelyn's page does not state an extra Combat requirement; this is recorded as an absence, not invented positive evidence.

## Adjacent findings

These findings were outside the October 9 correction. Both are now resolved by the [October 12 entry and Slayer mirror correction](retained-entry-requirements-2026-10-12.md); the historical evidence bundle remains unchanged.

| Retained task | Finding |
| --- | --- |
| Attack and Strength: Gain access to Warriors' Guild | Requiring 65 in both skills is sufficient but excludes valid alternatives. The true gate is Attack + Strength at least 130, OR 99 in either skill, without boosts. [Revision 37169629](https://runescape.wiki/w/Special:PermanentLink/37169629) |
| Combat: Receive a slayer assignment from Mandrith | Combat 120 is correct; this Combat mirror also says Slayer 85 while the canonical Slayer row and current master require 95. [Revision 37129615](https://runescape.wiki/w/Special:PermanentLink/37129615) |

## Reproduction and validation

`scripts/research/retained-task-requirements.mjs` reads only the retained export and the public Wiki API. It refuses an existing output and paths outside this worktree; create a new evidence version with `node scripts/research/retained-task-requirements.mjs --output app/data/retained-task-corrections.YYYY-MM-DD.vN.json`. Repository text hashes use canonical LF bytes. The committed bundle hashes its generator and reference; Wiki pins retain revision timestamps and full wikitext hashes without copying articles.

Focused tests cover the real retained record, stable identity and geography, entry alternatives, separate teleport facts, immutable input, idempotence, custom drift, invalid fields, exact provenance and complete Combat audit coverage. Run `node --test tests/retained-task-corrections.test.mjs`. Engine integration and its alternative-requirement behavioral tests belong to the parent lane; this worker did not edit the engine, loader or UI and did not open live or copied private saves.
