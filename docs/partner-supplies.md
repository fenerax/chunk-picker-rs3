# Ask your partner

Open **Info → Ask your partner** to see each player's unfinished own tasks that
need supplies from the other's chunks. The list includes blocked tasks whose
item source is reachable, with a reminder that other requirements remain. It
leaves out completed, backlogged, hidden, unsupported and membership/level-cap-blocked tasks, and tasks defined
only by the partner's territory. It follows the saved completion rule and does
not depend on the sidebar's search or owner filter.
Available goals follow the engine's existing task presentation, including its
chosen methods; blocked own obligations remain inspectable.

Whole-quest goals include item evidence from their required hidden steps, using
the engine's compiled same-quest links. A personally completed step contributes
no request; the partner finishing a step does not finish your character's quest.
External quests and alternative prerequisite branches are not flattened into
mandatory supplies.

Each request names the task and has **Where to gather** with the giver's admitted
sources. Identical items with identical permitted sources share a row. Different
source restrictions keep separate rows. Alternatives are choices: an engine
alias needing two distinct items never becomes a quantity of two units.

**Copy for Discord** copies a bounded summary and offers selectable text when
the browser clipboard is unavailable. Viewer links have the same read-only list
and copy action. Sandbox asks you to exit before loading saved supplies. Opening
or refreshing the list does not save anything. There is no sent checkbox.

The model uses existing detailed task results for both players. The engine's
existing own-versus-partner supply check now emits `partnerItemNeeds` alongside
its explanation, using the same item/source policies. Each group includes the
distinct-choice count, locally satisfied count, missing item choices and eligible
non-own source evidence. The browser matches that evidence to the giver's own
admitted sources. It does not run another access or item engine. Lightweight
sidebar projections are not sufficient, and stale or incomplete results do not
produce a confident empty list.

Required unit counts appear only where task data supplies them, currently the
authored house-storage material recipes. Ordinary retained `Items` requirements
usually name items without counts. Acquisition yields, shop stock and drop
quantities are not required amounts. Counts remain per task; the list does not
assume that reusable supplies must be gathered again for every task. It cannot
see inventory, group-bank stock or actual trades. Personal reward sources are
omitted because the source data does not establish that they can be transferred.
This is not a complete item tradeability catalogue. Sources requiring multiple distinct witnesses and virtual unselected
processing outputs are conservatively omitted when no single admitted giver
source proves the request.

Focused model, engine-output and fake-DOM tests are classified in the quick
suite. Copied-save browser evidence is kept locally under `.local/screens/`.
