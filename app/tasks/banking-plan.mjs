import { calculateBankingRates } from '../training/banking-rates.mjs';

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
  if (!availability.bankingRoutes && availability.gatheringMode !== 'bank') return metric;
  const settings = { oreBox: availability.gatheringOreBox ?? 'none', woodBox: availability.gatheringWoodBox ?? 'none',
    baitItem: method.inputs?.[0]?.item ?? null, bankSeconds: 3, boxFillSeconds: 1.2, boxEmptySeconds: 1.2 };
  const input = { xpPerHour: metric.xpPerHour, resources: resources(method, metric), skill: method.skill, level, settings };
  const baseline = calculateBankingRates(input);
  if (!baseline) return metric;
  const discovered = availability.bankingRoutes?.(method);
  const routeRows = Array.isArray(discovered) ? discovered : discovered?.spots ?? [];
  const routed = routeRows.filter(row => row.status === 'routed').sort((a, b) => a.tileSteps - b.tileSteps);
  // Different noting capacity can make a farther ordinary bank faster overall.
  const candidates = detail ? routeRows : routed.filter((row, index) => routed.findIndex(other => other.destination?.kind === row.destination?.kind) === index);
  const spots = candidates.map(row => {
    const spot = row.spot ?? row;
    const roundTrip = Number.isFinite(row.roundTripTileSteps) ? row.roundTripTileSteps : Number.isFinite(row.tileSteps) ? row.tileSteps * 2 : null;
    const base = { ...row, id: spot.id, label: spot.label ?? spot.name ?? `Spot in chunk ${spot.chunkId ?? ''}`,
      x: spot.x, y: spot.y, chunkIds: row.chunks ?? [], tileSteps: roundTrip,
      walkingSeconds: roundTrip === null ? null : roundTrip * 0.6, drop: baseline.drop };
    if (row.status !== 'routed') return base;
    const cycle = calculateBankingRates({ ...input, route: { tileSteps: row.tileSteps, kind: row.destination?.kind ?? 'bank' } });
    if (!cycle?.bank) return { ...base, status: 'unknown' };
    let runningCycle;
    if (detail && availability.bankingAdvanced) runningCycle = calculateBankingRates({ ...input,
      route: { tileSteps: row.tileSteps, kind: row.destination?.kind ?? 'bank' },
      settings: { ...settings, travelMode: 'run', energy: { initialPercent: 100, drainPercentPerRunTick: 0.7, regenPercentPerSecond: 0.8 } } });
    const running = runningCycle?.running;
    return { ...base, rates: { walking: cycle.bank, ...(running ? { running } : {}) },
      limitations: [...(row.limitations ?? []), ...cycle.assumptions,
        ...(running ? [...runningCycle.assumptions, 'Running is a low-weight scenario: 0.7% energy per run tick and 0.8% recovery per second. Recovery is uncertain; walking is used for plans.'] : [])] };
  }).sort((a, b) => (b.rates?.walking?.xpPerHour ?? -1) - (a.rates?.walking?.xpPerHour ?? -1));
  const best = spots.find(spot => spot.rates?.walking);
  const mode = availability.gatheringMode ?? 'drop';
  const effective = mode === 'bank' ? best?.rates.walking : baseline.drop;
  const fraction = effective?.gatheringFraction ?? null;
  return { ...metric, ...(metric.fishing ? { label: `Catch ${metric.fishing.species.map(fish => fish.label?.toLowerCase() ?? fish.id).join(' and ')}` } : {}), xpPerHour: effective?.xpPerHour ?? null,
    ...(metric.orePerHour !== undefined ? { orePerHour: fraction === null ? null : metric.orePerHour * fraction } : {}),
    ...(metric.logsPerHour !== undefined ? { logsPerHour: fraction === null ? null : metric.logsPerHour * fraction } : {}),
    ...(metric.fishPerHour !== undefined ? { fishPerHour: fraction === null ? null : metric.fishPerHour * fraction } : {}),
    ...(metric.species && fraction !== null ? { species: metric.species.map(fish => ({ ...fish, fishPerHour: fish.fishPerHour * fraction, xpPerHour: fish.xpPerHour * fraction })) } : {}),
    ...(metric.fishing && fraction !== null ? { fishing: { ...metric.fishing, xpPerHour: effective.xpPerHour,
      fishPerHour: metric.fishPerHour * fraction,
      species: metric.fishing.species.map(fish => ({ ...fish, fishPerHour: fish.fishPerHour * fraction, xpPerHour: fish.xpPerHour * fraction })) } } : {}),
    banking: { mode, level, status: best ? 'routed' : routeRows.some(row => row.status === 'no-bank') ? 'no-bank' : 'unknown',
      drop: baseline.drop, spots: detail ? spots : best ? [best] : [],
      selectedSpotId: best?.id ?? null, limitations: baseline.assumptions } };
}
