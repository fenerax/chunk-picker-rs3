import { calculateBankingRates } from '../training/banking-rates.mjs';
import { calculateGatheringProcessing } from '../training/gathering-processing.mjs';
import { bankingTripTravel, BANKING_TRAVEL_SOURCES } from '../training/banking-travel.mjs';

const gatheringSkills = new Set(['Mining', 'Woodcutting', 'Fishing']);
const quantity = (method, metric) => metric.orePerHour ?? metric.logsPerHour ?? metric.fishPerHour;

function resources(method, metric) {
  if (metric.fishing) return metric.fishing.species.map(fish => ({ id: fish.id, item: fish.item, perHour: fish.fishPerHour }));
  const id = method.miningCurve?.rockId ?? method.woodcuttingCurve?.treeId;
  return [{ id, item: method.outputs?.[0]?.item ?? method.output ?? id, perHour: quantity(method, metric) }];
}

/** Route discovery is shared by all level steps; cycles remain level-aware. */
export function createGatheringRouteLookup(provider, availability) {
  const routes = new Map();
  return method => {
    if (!routes.has(method.id)) routes.set(method.id, provider.routesForGathering({ method, availability }));
    return routes.get(method.id);
  };
}

/** Preserve the underlying XP/resource curves; apply the cycle's time fraction. */
export function withGatheringBanking(metric, method, level, availability, detail = false) {
  if (!gatheringSkills.has(method.skill) || !Number.isFinite(metric.xpPerHour) || !Number.isFinite(quantity(method, metric))) return metric;
  if (!availability.bankingRoutes && availability.gatheringMode !== 'bank' && (!availability.gatheringProcessing || availability.gatheringProcessing === 'none')) return metric;
  const settings = { oreBox: availability.gatheringOreBox ?? 'none', woodBox: availability.gatheringWoodBox ?? 'none',
    baitItem: method.inputs?.[0]?.item ?? null, bankSeconds: 3, boxFillSeconds: 1.2, boxEmptySeconds: 1.2 };
  const input = { xpPerHour: metric.xpPerHour, resources: resources(method, metric), skill: method.skill, level, settings };
  const baseline = calculateBankingRates(input);
  if (!baseline) return metric;
  const requestedProcessing = availability.gatheringProcessing ?? 'none';
  const processingMode = requestedProcessing === 'cook-drop' && method.skill === 'Fishing'
    || requestedProcessing === 'fletch-drop' && method.skill === 'Woodcutting' ? requestedProcessing : 'none';
  const processing = processingMode !== 'none' && method.skill !== 'Mining' ? calculateGatheringProcessing({ ...input,
    mode: processingMode, cookingLevel: availability.skills?.Cooking, fletchingLevel: availability.skills?.Fletching,
    members: availability.members === true, confirmedCookingFacility: availability.gatheringCookingFacility ?? 'unknown',
    ...(availability.gatheringCookingSuccess && availability.gatheringCookingSuccess !== 'unknown'
      ? { cookingSuccessChance: Number(availability.gatheringCookingSuccess) / 100 } : {}),
    batchSize: baseline.drop.capacity }) : null;
  const discovered = availability.bankingRoutes?.(method);
  const routeRows = Array.isArray(discovered) ? discovered : discovered?.spots ?? [];
  const candidates = routeRows;
  const surge = availability.gatheringSurge === 'on' && (availability.skills?.Agility === undefined || availability.skills.Agility >= 5);
  const spots = candidates.map(row => {
    const spot = row.spot ?? row;
    const roundTrip = Number.isFinite(row.roundTripTileSteps) ? row.roundTripTileSteps : Number.isFinite(row.tileSteps) ? row.tileSteps * 2 : null;
    const base = { ...row, id: spot.id, label: spot.label ?? spot.name ?? `Spot in chunk ${spot.chunkId ?? ''}`,
      x: spot.x, y: spot.y, chunkIds: row.chunks ?? [], tileSteps: roundTrip,
      walkingSeconds: roundTrip === null ? null : roundTrip * 0.6, drop: baseline.drop };
    if (row.status !== 'routed') return base;
    const options = [row, row.teleportOption].filter(Boolean).flatMap(option => {
      const route = { tileSteps: option.tileSteps, kind: option.destination?.kind ?? 'bank' };
      const initial = calculateBankingRates({ ...input, route });
      if (!initial?.bank) return [];
      const travel = bankingTripTravel(option, { surge, gatheringSeconds: initial.bank.gatheringSeconds + initial.bank.boxHandlingSeconds,
        destinationSeconds: initial.bank.destinationSeconds });
      if (!travel) return [];
      const cycle = calculateBankingRates({ ...input, route: { ...route, travelSeconds: travel.travelSeconds } });
      return cycle?.bank ? [{ option, travel, cycle }] : [];
    }).sort((a, b) => a.cycle.bank.cycleSeconds - b.cycle.bank.cycleSeconds);
    if (!options.length) return { ...base, status: 'unknown' };
    const { option, travel, cycle } = options[0];
    let runningCycle;
    if (detail && availability.bankingAdvanced && !row.extraTravelSeconds) runningCycle = calculateBankingRates({ ...input,
      route: { tileSteps: row.tileSteps, kind: row.destination?.kind ?? 'bank' },
      settings: { ...settings, travelMode: 'run', energy: { initialPercent: 100, drainPercentPerRunTick: 0.7, regenPercentPerSecond: 0.8 } } });
    const running = runningCycle?.running;
    return { ...base, destination: option.destination, rates: { walking: cycle.bank, ...(running ? { running } : {}) },
      tileSteps: option.lodestone ? option.outboundTileSteps + option.returnTileSteps : base.tileSteps,
      chunkIds: option.chunks ?? base.chunkIds,
      walkingSeconds: (row.tileSteps * 1.2) + (row.extraTravelSeconds ?? 0),
      travel: { ...travel, lodestone: option.lodestone ?? null, interiorEstimate: option.destination?.interiorEstimate ?? null,
        mode: option.lodestone ? 'lodestone' : travel.surgeUses ? 'surge' : 'walk', sources: BANKING_TRAVEL_SOURCES },
      limitations: [...(row.limitations ?? []), ...(option.limitations ?? []),
        ...cycle.assumptions.filter(note => !option.lodestone || !note.startsWith('Walking uses')),
        ...(option.lodestone ? [`Travel includes ${option.teleportSeconds} seconds casting, ${option.outboundTileSteps} outbound walking steps and ${option.returnTileSteps} return walking steps, plus any stated interior estimate.`] : []),
        ...(surge ? ['Surge uses verified straight surface stretches only, up to ten tiles per cast with a 20.4-second cooldown. One tick per cast is a conservative timing assumption. Each trip starts with a conservative cooldown bound; no Double Surge or Mobile.'] : []),
        ...(travel.geometryMissing ? ['Surge savings are unknown without the route geometry; ordinary walking is used.'] : []),
        ...(availability.gatheringSurge === 'on' && !surge ? ['Surge requires personal Agility 5; it is excluded at the saved lower level.'] : []),
        ...(running ? [...runningCycle.assumptions, 'Running is a low-weight scenario: 0.7% energy per run tick and 0.8% recovery per second. Recovery is uncertain; walking is used for plans.'] : [])] };
  }).sort((a, b) => (b.rates?.walking?.xpPerHour ?? -1) - (a.rates?.walking?.xpPerHour ?? -1));
  const best = spots.find(spot => spot.rates?.walking);
  const mode = availability.gatheringMode ?? 'drop';
  const effective = mode === 'bank' ? best?.rates.walking : processing ?? baseline.drop;
  const fraction = effective?.gatheringFraction ?? null;
  return { ...metric, ...(metric.fishing ? { label: `Catch ${metric.fishing.species.map(fish => fish.label?.toLowerCase() ?? fish.id).join(' and ')}` } : {}), xpPerHour: effective?.xpPerHour ?? null,
    ...(metric.orePerHour !== undefined ? { orePerHour: fraction === null ? null : metric.orePerHour * fraction } : {}),
    ...(metric.logsPerHour !== undefined ? { logsPerHour: fraction === null ? null : metric.logsPerHour * fraction } : {}),
    ...(metric.fishPerHour !== undefined ? { fishPerHour: fraction === null ? null : metric.fishPerHour * fraction } : {}),
    ...(metric.species ? { species: metric.species.map(fish => ({ ...fish, fishPerHour: fraction === null ? null : fish.fishPerHour * fraction, xpPerHour: fraction === null ? null : fish.xpPerHour * fraction })) } : {}),
    ...(metric.fishing ? { fishing: { ...metric.fishing, xpPerHour: effective?.xpPerHour ?? null,
      fishPerHour: fraction === null ? null : metric.fishPerHour * fraction,
      species: metric.fishing.species.map(fish => ({ ...fish, fishPerHour: fraction === null ? null : fish.fishPerHour * fraction, xpPerHour: fraction === null ? null : fish.xpPerHour * fraction })) } } : {}),
    banking: { mode, level, status: best ? 'routed' : routeRows.some(row => row.status === 'no-bank') ? 'no-bank' : 'unknown',
      drop: baseline.drop, processing, spots: detail ? spots : best ? [best] : [],
      selectedSpotId: best?.id ?? null, limitations: baseline.assumptions } };
}
