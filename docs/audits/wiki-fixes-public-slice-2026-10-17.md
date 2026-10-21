# Public F2P dataset follow-through — 2026-10-17

`open-f2p` 0.6.0 applies the independently verifiable supply findings that fit
the existing public slice. It retains all 52 cells and walking links, adds five
activities, and preserves existing activity identities and requirements.
`baseline-0.5.0.json` retains the preceding published data for identity checks.
Its archive omits local receipt filenames for portability; page titles,
revisions, receipt hashes, gameplay facts and identities remain identical.
Existing saves remain bound to their dataset digest; this change does not migrate
them or change a live game.

| Finding | Public implementation | Wiki revision |
|---|---|---|
| Draynor wild onions | Ordinary pick activity in 12338, requiring admitted Onion scenery and producing renewable Onion. No Farming level, seed or experience. | [Onion scenery, 37147464](https://runescape.wiki/w/Onion_(scenery)?oldid=37147464) |
| Wild potatoes | Ordinary pick activities in 12595 and 13107 produce Raw potato. The generator selects the exact ungated F2P location rows and coordinates within those existing cells. | [Potato scenery, 37131971](https://runescape.wiki/w/Potato_(scenery)?oldid=37131971) |
| Ned's rope | Admitted Draynor Ned plus a renewable source of Coins **or** Ball of wool. The record retains 15 coins or 4 balls of wool for one rope. | [Ned, 37127315](https://runescape.wiki/w/Ned?oldid=37127315) |
| Karim's kebab | Admitted standard Al Kharid Karim plus a renewable coin source. The record retains one coin for one kebab. | [Karim, 37209164](https://runescape.wiki/w/Karim?oldid=37209164) |
| Ernest rewards | Separate finite preview: 3,000 Coins, 10 Egg and 300 Feather. Existing manual manor-access gates remain; these rewards never enter ordinary item closure or renewable training. | [Ernest the Chicken, 37153377](https://runescape.wiki/w/Ernest_the_Chicken?oldid=37153377) |

Dialogue activities use the explicit `closure-only` adapter. Reachable payment
sources establish potential repeatable supply, not a wallet balance, held stack,
completed purchase or consumed payment. Neither NPC becomes a fabricated shop
or ground spawn. Finite rewards distinguish blocked completion, attainable
completion and recorded personal completion. Remaining quantity and claim state
are untracked; personal completion does not establish an unspent reward stack.

The generator rebuilds offline from the authored review and pinned Wiki API
responses. Existing public pins were copied from the earlier public-data build
cache; the four added pins were copied from the audit's Wiki response cache and
validated by title, revision, content model and receipt. No new Wiki request was
needed. Public data contains independently reviewed Wiki facts and authored rules.
Adapted Wiki material in this note and dataset is under
[CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/).

## Coverage still outside this slice

The [bounded audit](wiki-audit-2026-10-17.md) covers more geography and mechanics
than the public dataset. This update does not claim to resolve those differences:

- Handles for Forks and its Catherby/Wendlewick sellers are absent from the
  public activity catalogue. No members-only Catherby seller is admitted and no
  replacement candle-price requirement is invented. The valid F2P alternative
  remains a future geography review. [Achievement, 36994980](https://runescape.wiki/w/Handles_for_Forks?oldid=36994980),
  [Candle Shop, 37177292](https://runescape.wiki/w/Candle_Shop?oldid=37177292),
  [Wendle's Wicks, 37108529](https://runescape.wiki/w/Wendle%27s_Wicks?oldid=37108529).
- Silk-stall theft is absent. Its reviewed level is 20, but adding a Thieving
  activity or Ardougne geography is outside this update.
  [Silk stall, 37209241](https://runescape.wiki/w/Silk_stall?oldid=37209241).
- New Varrock and Vinesweeper instance gates, Temple of Ikov equipment, Canifis
  entry alternatives, Nardah members supplies and other members-area findings
  require their own source data. Generic engine support does not add those
  records to this F2P slice.
- Wendlewick's fish deposit service, fishing-shop placement and black-candle
  exception require reviewed Havenhythe geography. This update adds no bank,
  deposit box, candle stock, walking edge or quest-entry assertion there.
- Other wild crop fields, occasional seed outputs, Aggie's dye recipes and
  wider quest rewards remain unreviewed. Onion supply alone does not add a
  public yellow-dye production recipe.

Verification uses named Node test files, including real pinned-cache offline
reconstruction with audited reads, baseline identity checks, synthetic evidence
drift failures, isolated crop access, alternative dialogue payments and finite
reward isolation. It does not establish in-game route traversal or observed
purchases, harvests or reward claims.
