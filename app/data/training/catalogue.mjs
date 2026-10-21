import { datasetJSON, selectedDataset } from "../../dataset-runtime.mjs";
const f2p = await datasetJSON("app/data/training/methods.f2p.json");
import { divinationEvidence as evidence, divinationTierLabel, divinationTierSelectors } from '../divination-training.mjs';

const economics = { gpPerAction: null, priceDate: null, sourceIds: [], notes: 'Variable energy/memory yield and travel; economics are unknown.' };
const common = { skill: 'Divination', maxLevel: 99, members: true, xpPerAction: null, xpPerHour: null,
  actionUnit: 'harvest', estimateQuality: 'unknown-throughput', inputs: [], outputs: [], economics };
const sources = evidence.tiers.flatMap(tier => [{ id: `divination-${tier.name.toLowerCase()}-wisp`,
  url: `https://runescape.wiki/w/${tier.name}_wisp?oldid=${tier.revision}`, revision: tier.revision, retrieved: evidence.reviewed },
  ...(tier.enrichedRevision ? [{ id: `divination-${tier.name.toLowerCase()}-enriched`,
    url: `https://runescape.wiki/w/Enriched_${tier.name.toLowerCase()}_wisp?oldid=${tier.enrichedRevision}`,
    revision: tier.enrichedRevision, retrieved: evidence.reviewed }] : [])]);

export const divinationMethods = evidence.tiers.map(tier => ({ ...common,
  id: `divination.${tier.name.toLowerCase()}-harvest.members`, label: `Harvest ${tier.name.toLowerCase()} wisps`, level: tier.level,
  matches: [divinationTierLabel(tier)],
  requirements: [{ anyOf: divinationTierSelectors(tier).map(name => ({ kind: 'npc', name })) },
    ...(tier.quest ? [{ kind: 'quest', name: tier.quest }] : [])],
  sourceIds: [`divination-${tier.name.toLowerCase()}-wisp`, 'divination-wisps', 'divination-colonies',
    ...(tier.enrichedRevision ? [`divination-${tier.name.toLowerCase()}-enriched`] : [])],
  assumptions: ['Requires an admitted colony source. Normal, stationary and enriched sources share the entry level. Enrichment is conditional on rift empowerment; no spawn frequency, XP/hour or conversion route is assumed.',
    ...(tier.name === 'Pale' ? ['Members may continue pale harvesting beyond level 5. The separate F2P trial method remains capped at 5.'] : [])],
}));
if (selectedDataset.capabilities.features?.training !== false) divinationMethods.push({ ...common, id: 'divination.colossi', label: 'Train Colossi Divination', level: evidence.colossi.level,
  matches: [evidence.colossi.label], requirements: [{ kind: 'object', name: evidence.colossi.object },
    { kind: 'quest-progress', name: evidence.colossi.quest, progress: 'partial', detail: evidence.colossi.questNote,
      completedMethod: { category: 'Divination', name: evidence.colossi.label, id: evidence.colossi.pickerId } }],
  sourceIds: ['divination-colossi', 'divination-colossus-remnants'],
  assumptions: ['Charge the supplied memory stone at the remnants. Mural delivery destinations need separately admitted routes. XP scales with level and travel; rates, output quantities and economics remain unknown.'],
});

/** The retained F2P catalogue and authenticated catalogue listing stay intact.
 * Training-plan and Area check additionally use this reviewed members subset. */
export const trainingCatalogue = { ...f2p, version: `${f2p.version}+${evidence.version}`,
  scope: `${f2p.scope} Reviewed members Divination methods are included as a separate supplement.`,
  methods: [...f2p.methods.map(method => method.id === 'divination.pale-harvest' ? { ...method,
    requirements: [{ anyOf: divinationTierSelectors(evidence.tiers[0]).map(name => ({ kind: 'npc', name })) }] } : method),
    ...divinationMethods], sources: [...f2p.sources, ...evidence.sources, ...sources] };
export default trainingCatalogue;
