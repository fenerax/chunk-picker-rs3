# Quest and Activity Info filters

Activity Info has Done, Doable and Blocked chips on Skills, Quests,
Achievements, Activities, Slayer and Clues. Choices also filter the rows inside
skill, quest, achievement, Slayer and clue groups. Level sorts from low to high
before pagination; entries without a known level stay last. All restores the
full list. Selecting several statuses includes any of them.

The Quests tab, Chunk Info's quest contents and Search's Tasks/Quests lists also have Not started,
In progress, Done and Can do now. Progress choices include any selected state;
Can do now further limits them. Quest Done requires personal whole-quest
completion, including zero-point miniquests. A completed step means In progress,
and a partner's challenge check does not complete a personal quest.

Can do now follows the whole-completion task's required routes. It supplies saved
account levels and personal quest completion to the existing training requirement
selector checks, retaining the engine's access, membership, rule and unsupported
blockers. Internal steps and reachable nonquest prerequisites can be performed
along the route. External quests need personal completion. Alternatives retain
their required counts. Missing saved levels, unsupported requirements and cycles
stay blocked; possible training levels do not substitute for saved account levels.
Doable continues to describe the existing task calculation, which can include
levels the chunks support training to. Obtainable supplies retain the existing
source semantics rather than claiming items are in the inventory.

Personal whole-quest completion also supplies readiness evidence for an external
stage of that same quest when every finite declared completion route requires
it. Counted alternatives, subquest boundaries and optional/postquest stages
retain their distinctions; incomplete or unsatisfiable declarations prove
nothing. This evidence neither marks stages done nor grants their outputs or
rewards, and does not change planning eligibility. It uses the same current-account
provenance checks as exact personal completion.

Activity Done includes personal or duo challenge completion, as the existing
activity progress rows do. Slayer assignments have no saved assignment-completion
record; Done can therefore show a checked assignment method, but does not infer
completed assignments. Quest groups without a whole-completion definition cannot
be confirmed Done or Can do now.

Independent tab and search choices are stored in the browser's
`rs3:activity-info-filters:v1` record. Corrupt or unavailable storage keeps the
controls usable. Filtering and sorting send no gameplay commands and remain
available to viewers; saved progress still uses the existing revision-checked
commands.

Focused tests cover readiness, selector alternatives, display selection,
persistence, nested lists and the shipped search dialog. Run the copied-save
browser review through `.local/with-heavy.ps1 node scripts/review-questfilters.mjs`.
It uses ports 8831/8832, closes its scratch server/browser and saves 1440px/390px
captures and its report in `.local/screens`.
