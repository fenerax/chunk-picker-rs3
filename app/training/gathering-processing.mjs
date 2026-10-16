// Browser-safe, bounded processing cycles. RuneScape Wiki facts: CC BY-NC-SA 3.0.
// Checked 2026-10-15 through api.php revision content, not search snippets.
const freezeRows = rows => Object.freeze(rows.map(row => Object.freeze(row)));
export const PROCESSING_SOURCES = freezeRows([
  ['Cooking', 37179285, '2026-09-18T11:52:50Z', '5f44ca366e3b52b68722840f27036bbae6250162ad462ab7197b5c486afd51c4'],
  ['Fletching', 37194649, '2026-10-01T19:16:32Z', 'dc4342fd412f37e366d466d9d77f8d5fa1c3f9f94617a3a85af848f48c10e544'],
  ['Shaft', 37171926, '2026-09-06T00:35:32Z', '9fdc7fc3a98c5499758197e9c1cf946729571e5ccd08644e69f9ffa0b1423acf'],
  ['Teak stock', 37120515, '2026-07-25T00:08:26Z', '8a87d14cbd8cbb0b33d29c0d0c3f5bfe1edfe368e20fec3b1e40cf7c9307b7d7'],
  ['Game tick/Ticks per action', 37145287, '2026-08-06T18:56:56Z', '4a2bad79e31abd3a9efcea7388cb2a578a7c274b93b29c132c70d455a97adf43'],
  ['Burnt food', 37054897, '2026-05-27T05:39:26Z', 'ad71a1540e2e2976295737418cd53cd2bcb13fd16dac6c4051a513b331b91e6b'],
].map(([title, oldid, timestamp, sourceSha256]) => ({title, oldid, timestamp, sourceSha256,
  url: `https://runescape.wiki/w/${encodeURIComponent(title.replaceAll(' ', '_'))}?oldid=${oldid}`})));

export const COOKING_RECIPES = freezeRows([
  ['minnow', 1, 15, 19], ['crayfish', 1, 30, 34], ['shrimps', 1, 30, 34],
  ['anchovies', 1, 30, 34], ['sardine', 1, 40, 38], ['herring', 5, 50, 41],
  ['trout', 15, 70, 50], ['pike', 20, 80, 53], ['salmon', 25, 90, 58],
  ['tuna', 30, 100, 63], ['lobster', 40, 120, 74], ['swordfish', 45, 140, 86],
].map(([resourceId, level, xpPerInput, noBurnLevel]) => ({resourceId, id: `cook-${resourceId}`,
  label: `Cook ${resourceId}`, level, xpPerInput, noBurnLevel, members: false, secondsPerInput: 2.4})));

// Current July 2026 tiers: yew products are members, even though the logs are F2P.
// Select the greatest XP/input eligible recipe; every listed recipe takes 3 ticks.
const shaftFacts = [
  ['normal', 1, 5, 15], ['oak', 10, 7.5, 20], ['willow', 20, 10, 25],
  ['teak', 30, 11.2, 30], ['maple', 40, 12.5, 35], ['acadia', 50, 13.7, 40], ['yew', 70, 17.5, 50],
];
const bowFacts = [
  ['normal', 1, 5, 5, 7.5], ['oak', 10, 10, 15, 14.7],
  ['willow', 20, 16.5, 25, 25], ['maple', 40, 41.5, 45, 46],
  ['acadia', 50, 50, 55, 58.3], ['yew', 70, 75, 75, 80],
];
export const FLETCHING_RECIPES = freezeRows([
  ...bowFacts.flatMap(([resourceId, shortLevel, shortXp, longLevel, longXp]) => [
    {resourceId, id: `${resourceId}-shortbow`, label: `${resourceId} shortbow (unstrung)`, level: shortLevel, xpPerInput: shortXp},
    {resourceId, id: `${resourceId}-longbow`, label: `${resourceId} longbow (unstrung)`, level: longLevel, xpPerInput: longXp},
  ]),
  {resourceId: 'teak', id: 'teak-stock', label: 'Teak stock', level: 33, xpPerInput: 21},
  ...shaftFacts.map(([resourceId, level, xpPerInput, outputQuantity]) => ({resourceId,
    id: `${resourceId}-shafts`, label: 'Shaft', level, xpPerInput, outputQuantity, stackable: true})),
].map(row => ({secondsPerInput: 1.8, outputQuantity: 1, stackable: false, ...row, members: row.resourceId === 'yew'})));

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonnegative = value => Number.isFinite(value) && value >= 0;
const probability = value => nonnegative(value) && value <= 1;
const levelValid = (level, maximum) => Number.isInteger(level) && level >= 1 && level <= maximum;

/**
 * Pure expected-fluid batch cycle. Caller supplies at-spot gathering curves and
 * checks gathering access. batchSize is the available RAW-input backpack slots;
 * tools/bait/reserved slots must already be deducted. Processing empties every
 * batch, including shafts and burnt food; nothing is banked or retained.
 *
 * Missing burn probabilities give a Cooking XP interval, never an invented
 * expected value. User probabilities are explicit scenarios. Published no-burn
 * levels safely establish success=1 without special ranges/gauntlets.
 * Invalid inputs return null; unmet requirements return status=unavailable with
 * null rates, so a selected processing mode cannot silently plan drop instead.
 */
export function calculateGatheringProcessing(input = {}) {
  if (!object(input)) return null;
  const {skill, resources, xpPerHour, mode, members = false, batchSize = 27,
    dropSecondsPerItem = .6, interfaceSecondsPerBatch = 1.2, cookingSuccessChance} = input;
  if (!['Mining', 'Woodcutting', 'Fishing'].includes(skill) || !nonnegative(xpPerHour)
    || !['cook-drop', 'fletch-drop'].includes(mode) || typeof members !== 'boolean'
    || !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 28
    || !nonnegative(dropSecondsPerItem) || !nonnegative(interfaceSecondsPerBatch)
    || !Array.isArray(resources) || !resources.length || resources.length > 100) return null;
  const ids = new Set();
  for (const row of resources) {
    if (!object(row) || typeof row.id !== 'string' || !row.id || ids.has(row.id) || !nonnegative(row.perHour)) return null;
    ids.add(row.id);
  }
  if (cookingSuccessChance !== undefined && !probability(cookingSuccessChance)
    && !(object(cookingSuccessChance) && Object.values(cookingSuccessChance).every(probability))) return null;
  const totalRate = resources.reduce((sum, row) => sum + row.perHour, 0);
  if (!(totalRate > 0) || !Number.isFinite(totalRate)) return null;
  const cooking = mode === 'cook-drop';
  const processingSkill = cooking ? 'Cooking' : 'Fletching';
  const assumptions = [
    'Expected species mix fills a batch of raw-input backpack slots; fractional items describe an average cycle. All outputs are dropped after each batch.',
    'Processing and gathering do not overlap. Input gathering rates already own depletion/relocation assumptions; no facility travel is added.',
    'Drop and interface delays are configurable planning assumptions, not measured server mechanics. Zero delays give a handling upper rate bound.',
    'Tools are available on the tool belt or in already reserved slots. No bonus XP, urns, outfit, boosts, assistance or saved ingredients.',
  ];
  const unavailable = (reasonCode, unavailableReason) => ({mode, status: 'unavailable', reasonCode, unavailableReason,
    gatheringFraction: null, xpPerHour: null, gatheringXpPerHour: null, resourcesPerHour: null,
    resources: resources.map(row => ({...row, perHour: null})), processingXpPerHour: {[processingSkill]: null},
    processingXpBoundsPerHour: {[processingSkill]: null}, retained: false, processedResources: [],
    gatheringSeconds: null, processingSeconds: null, droppingSeconds: null, interfaceSeconds: null,
    handlingSeconds: null, cycleSeconds: null, assumptions, sources: PROCESSING_SOURCES});
  if (skill !== (cooking ? 'Fishing' : 'Woodcutting')) return unavailable('unsupported-skill', `${processingSkill} processing requires ${cooking ? 'Fishing' : 'Woodcutting'} inputs.`);
  const level = cooking ? input.cookingLevel : input.fletchingLevel;
  if (level == null) return unavailable('missing-level', `Personal ${processingSkill} level is unknown.`);
  if (!levelValid(level, cooking ? 99 : 110)) return null;
  const facility = input.confirmedCookingFacility === true ? 'fire' : input.confirmedCookingFacility;
  if (cooking && !['fire', 'range'].includes(facility)) return unavailable('missing-facility', 'Confirm a usable, sustained fire or range at the gathering spot.');
  if (cooking) assumptions.push(
    'The confirmed cooking facility is usable at the gathering spot throughout the cycle. Creating, fuelling, relighting and travelling to a fire/range are excluded.',
    'Cooking uses four ticks and base XP per successful cook. Player-made fire/bonfire XP bonuses and special range effects are excluded.',
    'Burnt food stacks. Fish dropping is conservatively charged once per input, including failed cooks; actual burnt-stack dropping can take less time.',
    'Below the published no-burn level, absent success probabilities leave expected Cooking XP unknown; reported bounds allow every unresolved cook to fail or succeed.');
  else assumptions.push('Fletching uses three ticks per log and the highest XP eligible listed recipe. Unstrung bows and teak stocks are dropped individually; shafts share one stack per batch. No bowstrings or feathers are consumed.');

  const rows = [], skipped = [];
  for (const resource of resources.filter(row => row.perHour > 0)) {
    const recipes = cooking ? COOKING_RECIPES.filter(row => row.resourceId === resource.id)
      : FLETCHING_RECIPES.filter(row => row.resourceId === resource.id);
    const eligible = recipes.filter(row => (!row.members || members) && level >= row.level)
      .sort((a, b) => b.xpPerInput - a.xpPerInput || Number(a.stackable) - Number(b.stackable));
    const recipe = eligible[0];
    if (!recipe) {
      skipped.push({id: resource.id, reasonCode: !recipes.length ? 'unsupported-resource'
        : recipes.every(row => row.members) && !members ? 'members-required' : 'level-required'});
      continue;
    }
    const suppliedChance = typeof cookingSuccessChance === 'number' ? cookingSuccessChance
      : cookingSuccessChance && Object.hasOwn(cookingSuccessChance, resource.id) ? cookingSuccessChance[resource.id] : undefined;
    const successChance = !cooking ? 1 : suppliedChance ?? (level >= recipe.noBurnLevel ? 1 : null);
    rows.push({resource, recipe, successChance, successSource: !cooking ? 'guaranteed'
      : suppliedChance !== undefined ? 'user-scenario' : successChance === 1 ? 'published-no-burn-level' : 'unknown'});
  }
  if (!rows.length) return unavailable(skipped[0]?.reasonCode ?? 'unsupported-resource',
    skipped[0]?.reasonCode === 'members-required' ? 'These log processing recipes require membership.'
      : skipped[0]?.reasonCode === 'level-required' ? `Personal ${processingSkill} level is below the supported recipe requirement.`
        : 'No supported processing recipe for these resources.');

  const gatheringSeconds = batchSize / totalRate * 3600;
  let processingSeconds = 0, dropInteractions = batchSize, stackInputs = 0;
  for (const {resource, recipe} of rows) {
    const count = batchSize * resource.perHour / totalRate;
    processingSeconds += count * recipe.secondsPerInput;
    if (recipe.stackable) stackInputs += count;
  }
  if (stackInputs > 0) dropInteractions = batchSize - stackInputs + 1;
  const droppingSeconds = dropInteractions * dropSecondsPerItem;
  const interfaceSeconds = rows.length * interfaceSecondsPerBatch;
  const handlingSeconds = processingSeconds + droppingSeconds + interfaceSeconds;
  const cycleSeconds = gatheringSeconds + handlingSeconds;
  if (!Number.isFinite(cycleSeconds) || !Number.isFinite(gatheringSeconds) || gatheringSeconds <= 0) return null;
  const gatheringFraction = gatheringSeconds / cycleSeconds;
  let expectedXp = 0, minXp = 0, maxXp = 0, unknown = false;
  const processedResources = rows.map(({resource, recipe, successChance, successSource}) => {
    const perHour = resource.perHour * gatheringFraction;
    const upper = perHour * recipe.xpPerInput;
    if (successChance === null) { unknown = true; maxXp += upper; }
    else { expectedXp += upper * successChance; minXp += upper * successChance; maxXp += upper * successChance; }
    return {id: resource.id, recipeId: recipe.id, label: recipe.label, perHour,
      xpPerInput: recipe.xpPerInput, outputQuantity: recipe.outputQuantity ?? 1, stackable: recipe.stackable ?? false,
      successChance, successSource, xpPerHour: successChance === null ? null : upper * successChance};
  });
  if (![minXp, maxXp, expectedXp, xpPerHour * gatheringFraction].every(Number.isFinite)) return null;
  if (rows.some(row => row.successSource === 'user-scenario')) assumptions.push('Supplied cooking success probabilities are user scenarios, not probabilities inferred from Cooking level or a verified burn formula.');
  if (skipped.length) assumptions.push('Resources without an eligible recipe are dropped raw; only the listed eligible resources receive processing XP.');
  return {mode, status: skipped.length ? 'partial' : unknown ? 'bounded' : 'estimated',
    reasonCode: unknown ? 'missing-burn-data' : skipped.length ? 'partial-eligibility' : null,
    unavailableReason: null, xpStatus: unknown ? 'bounded' : 'estimated', gatheringFraction,
    xpPerHour: xpPerHour * gatheringFraction, gatheringXpPerHour: xpPerHour * gatheringFraction,
    resourcesPerHour: totalRate * gatheringFraction,
    resources: resources.map(row => ({...row, perHour: row.perHour * gatheringFraction})),
    processingXpPerHour: {[processingSkill]: unknown ? null : expectedXp},
    processingXpBoundsPerHour: {[processingSkill]: {min: minXp, max: maxXp}},
    gatheringSeconds, processingSeconds, droppingSeconds, interfaceSeconds, handlingSeconds, cycleSeconds,
    batchSize, retained: false, processedResources, skippedResources: skipped, assumptions, sources: PROCESSING_SOURCES};
}
