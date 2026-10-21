// Pure banking-cycle estimates. Numerical storage/movement rules are pinned in
// docs/research/gathering-calculator.md (checked 2026-10-12).
// Resource rates and XP rates deliberately remain independent, especially Mining.
export const BANKING_DEFAULTS = Object.freeze({
  backpackSlots: 28, reservedSlots: 0, bankSeconds: 3,
  boxFillSeconds: 1.2, boxEmptySeconds: 1.2, dropSecondsPerItem: 0,
});
export const ORE_BOX_TIERS = Object.freeze(['none', 'bronze', 'iron', 'steel', 'mithril', 'adamant', 'rune']);
export const WOOD_BOX_TIERS = Object.freeze(['none', 'basic', 'oak', 'willow', 'teak', 'maple', 'acadia']);
const oreRules = {
  copper: [1, 7], tin: [1, 7], iron: [2, 18], coal: [3, 29], silver: [3, Infinity],
  mithril: [4, 37], adamantite: [5, 41], luminite: [5, 41], gold: [5, Infinity], runite: [6, 55],
};
const woodRules = {normal: 1, achey: 1, oak: 2, willow: 3, teak: 4, maple: 5,
  acadia: 6, 'arctic-pine': 6, eucalyptus: 6};
const stilesFish = new Set(['tuna', 'lobster', 'swordfish']);
const nonnegative = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const boundedLevel = n => Number.isInteger(n) && n >= 1 && n <= 110;

/** Owned tier only: obtainable/craftable items and duplicate boxes confer nothing. */
export function boxCapacity({skill, level, resourceId, oreBox = 'none', woodBox = 'none'} = {}) {
  if (!boundedLevel(level) || !ORE_BOX_TIERS.includes(oreBox) || !WOOD_BOX_TIERS.includes(woodBox)) return null;
  if (skill === 'Mining') {
    const rule = oreRules[resourceId];
    return rule && ORE_BOX_TIERS.indexOf(oreBox) >= rule[0] ? (level >= rule[1] ? 120 : 100) : 0;
  }
  if (skill === 'Woodcutting') {
    const tier = WOOD_BOX_TIERS.indexOf(woodBox), required = woodRules[resourceId];
    return required && tier >= required ? 60 + tier * 10 + Math.min(11, Math.floor((level + 5) / 10)) * 10 : 0;
  }
  return skill === 'Fishing' ? 0 : null;
}

// Solve the expected backpack occupancy at time t: each species first consumes
// its own box allocation, then competes for the shared unstackable backpack.
function fillCycle(resources, boxCapacities, backpackSlots) {
  const points = resources.filter(row => row.perHour > 0).map(row => ({
    rate: row.perHour / 3600, capacity: boxCapacities[row.id],
    threshold: boxCapacities[row.id] / (row.perHour / 3600),
  })).sort((a, b) => a.threshold - b.threshold);
  let rate = 0, capacity = 0, seconds = 0;
  for (let i = 0; i < points.length; i++) {
    rate += points[i].rate; capacity += points[i].capacity;
    seconds = (backpackSlots + capacity) / rate;
    if (i === points.length - 1 || seconds <= points[i + 1].threshold) break;
  }
  const stored = resources.reduce((sum, row) => sum + Math.min(boxCapacities[row.id], row.perHour / 3600 * seconds), 0);
  return {seconds, capacity: backpackSlots + stored, stored,
    // One transfer can clear at most a backpack. Actual click timing is unknown.
    boxFills: stored > 0 ? Math.max(1, Math.ceil(stored / backpackSlots - 1e-10)) : 0};
}

const recover = (energy, seconds, regen) => Math.min(100, energy + seconds * regen);
function runLeg(tileSteps, energy, drain, regen) {
  const runTicks = Math.min(Math.ceil(tileSteps / 2), Math.floor((energy + 1e-10) / drain));
  const runSteps = Math.min(tileSteps, runTicks * 2), walkSteps = tileSteps - runSteps;
  const depletedEnergy = Math.max(0, energy - runTicks * drain);
  const recoveredEnergy = recover(depletedEnergy, .6 * walkSteps, regen);
  return {seconds: .6 * (runTicks + walkSteps), runSteps, walkSteps,
    energy: recoveredEnergy, minimum: depletedEnergy, maximum: Math.max(energy, recoveredEnergy)};
}

function runningCycle({tileSteps, gatheringSeconds, boxHandlingSeconds, destinationSeconds, energy}) {
  const {initialPercent, drainPercentPerRunTick: drain, regenPercentPerSecond: regen} = energy;
  let current = initialPercent, minimum = current, maximum = current;
  const seen = new Map(), records = [];
  let periodStart = 0, converged = false;
  // Find a stable cycle or periodic sequence. Energy carries through every
  // gathering, filling, outbound, destination-handling and return phase.
  for (let i = 0; i < 4096; i++) {
    const key = current.toFixed(8);
    if (seen.has(key)) { periodStart = seen.get(key); converged = true; break; }
    seen.set(key, i);
    const beforeGathering = current;
    current = recover(current, gatheringSeconds + boxHandlingSeconds, regen);
    const outbound = runLeg(tileSteps, current, drain, regen);
    current = recover(outbound.energy, destinationSeconds, regen);
    const inbound = runLeg(tileSteps, current, drain, regen);
    current = inbound.energy;
    minimum = Math.min(minimum, current, outbound.minimum, inbound.minimum);
    maximum = Math.max(maximum, current, outbound.maximum, inbound.maximum);
    records.push({travelSeconds: outbound.seconds + inbound.seconds,
      runSteps: outbound.runSteps + inbound.runSteps, walkSteps: outbound.walkSteps + inbound.walkSteps,
      startEnergyPercent: beforeGathering, endEnergyPercent: current});
  }
  if (!converged) periodStart = Math.max(0, records.length - 1024);
  const steady = records.slice(periodStart), count = steady.length;
  const average = field => steady.reduce((sum, row) => sum + row[field], 0) / count;
  return {travelSeconds: average('travelSeconds'), runSteps: average('runSteps'), walkSteps: average('walkSteps'),
    energy: {...energy, firstCycle: records[0], startEnergyPercent: average('startEnergyPercent'),
      endEnergyPercent: average('endEnergyPercent'), minimumPercent: minimum, maximumPercent: maximum,
      steadyMinPercent: Math.min(...steady.map(row => row.endEnergyPercent)),
      steadyMaxPercent: Math.max(...steady.map(row => row.endEnergyPercent)),
      simulatedCycles: records.length, periodicCycles: converged ? count : null, converged}};
}

function estimate({xpPerHour, resources, capacity, gatheringSeconds, handlingSeconds, travelSeconds, retained, ...extra}) {
  const cycleSeconds = gatheringSeconds + handlingSeconds + travelSeconds;
  const gatheringFraction = gatheringSeconds / cycleSeconds;
  return {capacity, gatheringSeconds, handlingSeconds, travelSeconds, cycleSeconds, gatheringFraction,
    xpPerHour: xpPerHour * gatheringFraction,
    resourcesPerHour: resources.reduce((sum, row) => sum + row.perHour, 0) * gatheringFraction,
    retainedResourcesPerHour: retained ? resources.reduce((sum, row) => sum + row.perHour, 0) * gatheringFraction : 0,
    resources: resources.map(row => ({...row, perHour: row.perHour * gatheringFraction,
      retainedPerHour: retained ? row.perHour * gatheringFraction : 0})), ...extra};
}

/** Return null for malformed rate/settings input; absent route keeps drop usable.
 * skill names match the existing rate/planner modules. tileSteps is ONE WAY.
 * Expected fluid species mix, not a stochastic inventory simulation.
 */
export function calculateBankingRates(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const {xpPerHour, resources, skill, level, route = null} = input;
  if (!nonnegative(xpPerHour) || !boundedLevel(level) || !['Mining', 'Woodcutting', 'Fishing'].includes(skill)
    || !Array.isArray(resources) || !resources.length || resources.length > 100) return null;
  const ids = new Set();
  for (const row of resources) {
    if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id) || !nonnegative(row.perHour)) return null;
    ids.add(row.id);
  }
  const totalRate = resources.reduce((sum, row) => sum + row.perHour, 0);
  if (!(totalRate > 0) || !Number.isFinite(totalRate)) return null;
  if (input.settings != null && (typeof input.settings !== 'object' || Array.isArray(input.settings))) return null;
  const settings = {...BANKING_DEFAULTS, oreBox: 'none', woodBox: 'none', baitItem: null,
    travelMode: 'walk', ...input.settings};
  if (!Number.isInteger(settings.backpackSlots) || settings.backpackSlots < 1 || settings.backpackSlots > 28
    || !Number.isInteger(settings.reservedSlots) || settings.reservedSlots < 0
    || !ORE_BOX_TIERS.includes(settings.oreBox) || !WOOD_BOX_TIERS.includes(settings.woodBox)
    || !['walk', 'run'].includes(settings.travelMode)
    || ![settings.bankSeconds, settings.boxFillSeconds, settings.boxEmptySeconds, settings.dropSecondsPerItem].every(nonnegative)
    || (settings.baitItem !== null && typeof settings.baitItem !== 'string')) return null;
  if (settings.travelMode === 'run') {
    const energy = settings.energy;
    if (!energy || !nonnegative(energy.initialPercent) || energy.initialPercent > 100
      || !nonnegative(energy.drainPercentPerRunTick) || energy.drainPercentPerRunTick <= 0 || energy.drainPercentPerRunTick > 100
      || !nonnegative(energy.regenPercentPerSecond)) return null;
  }
  // Also infer bait from the requested fish, so a missing UI field cannot grant
  // a free slot to fly/bait fishing. Tools are assumed equipped/on the tool belt.
  const baitSlot = skill === 'Fishing' && (settings.baitItem || resources.some(row => ['trout', 'salmon', 'sardine', 'herring', 'pike'].includes(row.id))) ? 1 : 0;
  const boxSlot = (skill === 'Mining' && settings.oreBox !== 'none') || (skill === 'Woodcutting' && settings.woodBox !== 'none') ? 1 : 0;
  const dropSlots = settings.backpackSlots - settings.reservedSlots - baitSlot - boxSlot;
  if (dropSlots <= 0) return null;
  const assumptions = [
    'Expected resource mix fills shared backpack slots; each supported species has its own box capacity. Fractional items describe an average cycle.',
    'Owned box tier is explicit. One box occupies one slot; duplicate boxes do not increase capacity. Tools are equipped or on the tool belt; other carried items use reservedSlots.',
    'Box filling is estimated as one interaction per backpack of stored items; interface, fill, empty and drop delays are configurable assumptions, not measured game rates.',
    'Drop keeps any owned carried box slot reserved but does not fill it; only gathered backpack items are dropped. Zero drop handling is an uninterrupted upper bound.',
    'Walking uses one tile per 0.6-second tick in both directions; supplied tileSteps includes diagonal steps and is one way.',
  ];
  const dropGatheringSeconds = dropSlots * 3600 / totalRate;
  if (!Number.isFinite(dropGatheringSeconds) || dropGatheringSeconds <= 0
    || !Number.isFinite(dropGatheringSeconds + dropSlots * settings.dropSecondsPerItem)) return null;
  const drop = estimate({xpPerHour, resources, capacity: dropSlots, gatheringSeconds: dropGatheringSeconds,
    handlingSeconds: dropSlots * settings.dropSecondsPerItem, travelSeconds: 0, retained: false,
    label: settings.dropSecondsPerItem === 0 ? 'Drop (uninterrupted upper bound)' : 'Drop (handling estimate)'});
  const boxCapacityByResource = Object.fromEntries(resources.map(row => [row.id, boxCapacity({...settings, skill, level, resourceId: row.id})]));
  const noteSlots = route?.kind === 'stiles' ? resources.filter(row => row.perHour > 0).length : 0;
  const backpackSlots = dropSlots - noteSlots;
  const inventory = {backpackSlots, totalBackpackSlots: settings.backpackSlots, reservedSlots: settings.reservedSlots,
    boxSlot, baitSlot, noteSlots, boxCapacityByResource, capacity: null};
  if (backpackSlots <= 0) return {inventory, drop, bank: null, running: null, assumptions, unavailableReason: 'No gathering slots remain after carried items.'};
  const fill = fillCycle(resources, boxCapacityByResource, backpackSlots);
  if (!Number.isFinite(fill.seconds) || !Number.isFinite(fill.capacity) || fill.seconds <= 0) return null;
  Object.assign(inventory, {capacity: fill.capacity, boxStoredPerTrip: fill.stored, boxFillsPerTrip: fill.boxFills});
  if (route == null) return {inventory, drop, bank: null, running: null, assumptions, unavailableReason: 'No verified storage route.'};
  if (!Number.isInteger(route.tileSteps) || route.tileSteps < 0 || route.tileSteps > 100000
    || !['bank', 'deposit', 'deposit-box', 'metal-bank', 'stiles'].includes(route.kind)
    || route.travelSeconds !== undefined && !nonnegative(route.travelSeconds)) return null;
  if (route.kind === 'stiles' && (skill !== 'Fishing' || resources.some(row => row.perHour > 0 && !stilesFish.has(row.id)))) {
    return {inventory, drop, bank: null, running: null, assumptions, unavailableReason: 'Stiles notes only tuna, lobster and swordfish.'};
  }
  if (route.kind === 'metal-bank' && (skill !== 'Mining' || resources.some(row => row.perHour > 0 && !oreRules[row.id]))) {
    return {inventory, drop, bank: null, running: null, assumptions, unavailableReason: 'Metal-bank route requires supported ores.'};
  }
  if (route.kind === 'stiles') assumptions.push('Repeating Stiles trips retain one noted stack per caught species in the backpack, including on the next trip. Bait stocks remain sufficient.');
  const boxHandlingSeconds = fill.boxFills * settings.boxFillSeconds;
  const destinationSeconds = settings.bankSeconds + (fill.stored > 0 ? settings.boxEmptySeconds : 0);
  if (!Number.isFinite(fill.seconds + boxHandlingSeconds + destinationSeconds + route.tileSteps * 1.2)) return null;
  const common = {xpPerHour, resources, capacity: fill.capacity, gatheringSeconds: fill.seconds,
    handlingSeconds: boxHandlingSeconds + destinationSeconds, retained: true, route: {...route},
    boxHandlingSeconds, destinationSeconds};
  const bank = estimate({...common, travelSeconds: route.travelSeconds ?? route.tileSteps * 1.2, label: route.kind === 'stiles' ? 'Walk to Stiles' : 'Walk and bank'});
  let running = null;
  if (settings.travelMode === 'run') {
    const energy = settings.energy;
    const run = runningCycle({tileSteps: route.tileSteps, gatheringSeconds: fill.seconds,
      boxHandlingSeconds, destinationSeconds, energy});
    running = estimate({...common, ...run, label: 'Run (advanced energy scenario)'});
    assumptions.push('Advanced running uses supplied uncertain drain/recovery inputs. Energy regenerates while gathering, handling and walking; each leg runs until depleted then walks the remainder. Running is retried on the next leg. No resting, Surge or energy consumables.',
      run.energy.converged ? 'Running averages the repeating energy cycle after its initial transient; energy is never reset per trip.' : 'Running did not settle into an exact periodic cycle in 4096 trips; the last 1024 trips provide an approximate sustainable average.');
  }
  return {inventory, drop, bank, running, assumptions, unavailableReason: null};
}
