import { datasetJSON } from "../dataset-runtime.mjs";
const evidence = await datasetJSON("app/data/divination.2026-10-13.v1.json");

export const divinationEvidence = evidence;
const lower = name => name.toLowerCase();
export const divinationTierLabel = tier => `Harvest ${['Elder', 'Incandescent'].includes(tier.name) ? 'an' : 'a'} ~|${lower(tier.name)} wisp|~`;
export const divinationTierAlias = tier => `Divination ${lower(tier.name)} sources[+]`;
export const divinationTierSelectors = tier => [`${tier.name} wisp`, `${tier.name} spring`,
  ...(tier.enrichedRevision ? [`Enriched ${lower(tier.name)} wisp`, `Enriched ${lower(tier.name)} spring`] : [])];

/** Retain the original task IDs and resource gates. Wisps and their stationary
 * springs are one method; enriched variants are neither a new tier nor a spawn
 * grant. Only the exact reviewed legacy harvesting records are patched. */
export function applyDivinationTraining(definitions, { enabled = false } = {}) {
  let result = definitions;
  for (const tier of evidence.tiers) {
    const label = divinationTierLabel(tier), original = definitions.challenges?.Divination?.[label];
    if (!original || original.Level !== tier.level || original.Primary !== true
      || JSON.stringify(original.NPCs) !== JSON.stringify([`${tier.name} wisp`])) continue;
    if (result === definitions) result = { ...definitions, challenges: { ...definitions.challenges }, codeItems: { ...definitions.codeItems } };
    result.challenges.Divination = { ...result.challenges.Divination, [label]: { ...original,
      NPCs: [divinationTierAlias(tier)], ...(tier.members ? { 'Not F2P': true } : {}),
      ...(tier.quest ? { PersonalQuestProgress: { quest: tier.quest, progress: 'complete' } } : {}) } };
    result.codeItems.npcsPlus = { ...result.codeItems.npcsPlus, [divinationTierAlias(tier)]: divinationTierSelectors(tier) };
  }
  const colossi = evidence.colossi;
  const reviewedCatalogue = enabled && (definitions.challenges?.Divination?.[divinationTierLabel(evidence.tiers[0])]?.NPCs?.includes(`${evidence.tiers[0].name} wisp`)
    || definitions.chunks?.[colossi.chunkId]?.Object?.[colossi.object]);
  // An exact resource selector is required: the Divine Fall map marker and
  // nearby Mining colossus do not prove access to the harvestable remnants.
  if (reviewedCatalogue && !definitions.challenges?.Divination?.[colossi.label]
    && !Object.values(definitions.challenges?.Divination ?? {}).some(row => row.PickerId === colossi.pickerId)) {
    if (result === definitions) result = { ...definitions, challenges: { ...definitions.challenges } };
    result.challenges.Divination = { ...result.challenges.Divination, [colossi.label]: {
      PickerId: colossi.pickerId, Level: colossi.level, Primary: true, 'Not F2P': true,
      Objects: [colossi.object], PersonalQuestProgress: { quest: colossi.quest, progress: colossi.questProgress, detail: colossi.questNote },
      Description: 'Speak to Aurriel at Divine Fall and charge the supplied memory stone at Colossus remnants. Mural deliveries need their own unlocked routes.',
    } };
  }
  return result;
}
