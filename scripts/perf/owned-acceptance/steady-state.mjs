// Ledger-first rule: owner decision, 2026-11-11. Charges are in their source
// units, never estimates to subtract from heapUsed, external, or arrayBuffers.
export const allowedOwners = Object.freeze(['History', 'response-caches', 'hot-snapshot', 'engine-variants', 'stateSnapshots']);
export const COMPILED_CODE_ALLOWANCE_BYTES = 1024 * 1024; // Whole process tree, not per group/round.
const valid = value => Number.isSafeInteger(value) && value >= 0;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const list = value => Array.isArray(value) ? value : [];
const key = row => `${row?.owner}/${row?.id}`;
const dimensions = row => list(row?.dimensions);
const enforcedDimension = dimension => record(dimension) && valid(dimension.used) && valid(dimension.cap) && dimension.enforced === true;
const byteLedger = row => dimensions(row).find(d => d?.unit === 'chargeBytes' && enforcedDimension(d));

export function inspectLedgers(owners) {
  const reasons = [], keys = new Set();
  if (!Array.isArray(owners)) reasons.push('invalid-ledger-inventory');
  for (const row of list(owners)) {
    if (!record(row)) { reasons.push('invalid-ledger'); continue; }
    if (keys.has(key(row))) reasons.push(`duplicate-ledger:${key(row)}`);
    keys.add(key(row));
    // An unlisted owner's numbers are unsupported evidence: they deny the
    // waiver (unlisted-owner) but never prove a hard cap violation.
    const listed = allowedOwners.includes(row.owner);
    if (!listed) reasons.push(`unlisted-owner:${row.owner}`);
    // The source flag may veto completeness, but cannot establish it without
    // actual enforced entry and byte ledgers. Projection uses this same check.
    if (row.complete !== true) reasons.push(`incomplete-owner:${key(row)}:${list(row.blockers).join(',')}`);
    for (const unit of ['entries', 'chargeBytes']) if (!dimensions(row).some(d => d?.unit === unit && enforcedDimension(d)))
      reasons.push(`missing-enforced-cap:${key(row)}/${unit}`);
    const units = new Set();
    for (const dimension of dimensions(row)) {
      if (units.has(dimension?.unit)) reasons.push(`duplicate-ledger-dimension:${key(row)}/${dimension?.unit}`);
      units.add(dimension?.unit);
      if (!enforcedDimension(dimension))
        reasons.push(`unenforced-cap:${key(row)}/${dimension?.unit}`);
      else if (listed && dimension.used > dimension.cap) reasons.push(`owner-over-cap:${key(row)}/${dimension.unit}`);
    }
  }
  for (const owner of allowedOwners) if (!list(owners).some(row => row?.owner === owner)) reasons.push(`missing-owner:${owner}`);
  return reasons;
}

// A cycle must name its actual admissions/finite working set. No guessed round
// count, or observed-below-cap flag, can establish that an owner was warmed.
export function warmupPlan(owners) {
  const blockers = inspectLedgers(owners), plans = [];
  for (const row of list(owners)) {
    const workload = row?.workload;
    const entryCap = dimensions(row).find(d => d?.unit === 'entries' && enforcedDimension(d))?.cap;
    if (!record(workload) || !valid(workload.newEntriesPerCycle) || workload.newEntriesPerCycle === 0 || !valid(entryCap)
      || Object.hasOwn(workload, 'workingSetEntries') && !valid(workload.workingSetEntries)) {
      blockers.push(`no-derived-warmup:${key(row)}`); continue;
    }
    const entries = valid(workload.workingSetEntries) ? Math.min(entryCap, workload.workingSetEntries) : entryCap;
    plans.push({ owner: row.owner, id: row.id, cycles: Math.ceil(entries / workload.newEntriesPerCycle),
      entries, basis: valid(workload.workingSetEntries) ? 'enumerated-workload' : 'enforced-entry-cap' });
  }
  return { status: blockers.length ? 'blocked' : 'planned', blockers, owners: plans,
    minimumCycles: plans.length ? Math.max(...plans.map(row => row.cycles)) : null };
}

export function capProjection(owners) {
  const incompleteLedgers = inspectLedgers(owners), complete = incompleteLedgers.length === 0;
  const missing = list(owners).filter(row => !byteLedger(row)).map(key);
  const sum = scope => list(owners).filter(row => row?.scope === scope && !row.includedInOtherCap).reduce((total, row) => total
    + (byteLedger(row)?.cap ?? 0), 0);
  const perGroup = sum('group') / Math.max(1, new Set(list(owners).filter(row => row?.scope === 'group').map(row => row.group)).size);
  const shared = sum('shared');
  return { diagnosticOnly: true, complete, incompleteLedgers, missingByteCaps: missing,
    perGroupByteCapSum: complete ? perGroup : null,
    projectedTotal100GroupBytes: complete ? perGroup * 100 + shared : null,
    projectedTotal500GroupBytes: complete ? perGroup * 500 + shared : null,
    knownPerGroupByteCapSubtotal: perGroup, knownSharedByteCapSubtotal: shared,
    knownProjected100GroupByteCapSubtotal: perGroup * 100 + shared,
    knownProjected500GroupByteCapSubtotal: perGroup * 500 + shared,
    note: 'Source ledger charge units; incomplete totals are null, never zero. No heap subtraction or new threshold.' };
}

// Spot checks can veto a proof, never establish missing caps or warm-up. Native
// growth is retained in the report but is intentionally absent from this math.
export function steadyStateRule(evidence) {
  const reasons = [];
  if (!record(evidence)) return { eligible: false, reasons: ['ledger-evidence-missing; raw-growth-gates-apply'] };
  if (evidence.uncoveredMaximum) reasons.push('uncovered-maximum');
  if (evidence.warmup?.status !== 'reached') reasons.push('warmup-not-reached');
  const samples = list(evidence.samples);
  if (samples.length < 2) reasons.push('insufficient-steady-samples');
  let inventory;
  for (const sample of samples) {
    if (!valid(sample?.heapUsedBytes) || !valid(sample?.nativeBytes)) reasons.push('invalid-sample-bytes');
    reasons.push(...inspectLedgers(sample?.owners));
    const current = JSON.stringify(list(sample?.owners).map(row => [key(row), row?.scope,
      dimensions(row).map(d => [d?.unit, d?.cap])]).sort());
    if (inventory !== undefined && current !== inventory) reasons.push('ledger-inventory-changed');
    inventory = current;
  }
  const first = samples[0], last = samples.at(-1);
  const plan = warmupPlan(first?.owners);
  reasons.push(...plan.blockers);
  for (const reached of list(evidence.warmup?.owners)) {
    const required = plan.owners.find(row => key(row) === key(reached));
    const owner = list(first?.owners).find(row => key(row) === key(reached));
    const entryCap = dimensions(owner).find(d => d?.unit === 'entries' && enforcedDimension(d))?.cap;
    if (!['cap', 'enumerated-working-set'].includes(reached?.basis) || !valid(reached?.requiredEntries)
      || !valid(reached?.attainedEntries) || reached.requiredEntries !== required?.entries
      || reached.attainedEntries < reached.requiredEntries || !valid(entryCap) || reached.attainedEntries > entryCap || reached.asserted !== true)
      reasons.push(`warmup-unasserted:${key(reached)}`);
  }
  for (const row of list(first?.owners)) {
    if (!list(evidence.warmup?.owners).some(w => key(w) === key(row))) reasons.push(`owner-not-warmed:${key(row)}`);
    // Flat in every source dimension, not a net positive/negative cancellation
    // between owners or a JSON-byte-to-V8 conversion.
    for (const dimension of dimensions(row)) if (samples.some(sample =>
      dimensions(list(sample?.owners).find(other => key(other) === key(row))).find(d => d?.unit === dimension?.unit)?.used !== dimension?.used))
      reasons.push(`nonflat-ledger:${key(row)}/${dimension?.unit}`);
  }
  if (evidence.spotChecks !== undefined && !Array.isArray(evidence.spotChecks)) reasons.push('invalid-spot-checks');
  for (const spot of list(evidence.spotChecks)) {
    if (spot?.uncoveredMaximum) reasons.push('uncovered-maximum');
    if (!valid(spot?.unattributedHeapGrowthBytes)) reasons.push('invalid-spot-check-unattributed-heap');
    else if (spot.unattributedHeapGrowthBytes > 0) reasons.push('spot-check-unattributed-heap');
    if (!Array.isArray(spot?.owners)) reasons.push('invalid-spot-check-owners');
    if (spot?.nativeGrowthBytes !== undefined && !Number.isSafeInteger(spot.nativeGrowthBytes)) reasons.push('invalid-spot-check-native-growth');
    for (const owner of list(spot?.owners)) {
      const listed = [...allowedOwners, 'compiled-code-feedback'].includes(owner?.owner);
      if (!listed) reasons.push(`unlisted-owner:${owner?.owner}`);
      if (!valid(owner?.cap) || !valid(owner?.used)) reasons.push(`invalid-spot-check-owner:${owner?.owner}`);
      else if (listed && owner.used > owner.cap) reasons.push(`spot-check-owner-over-cap:${owner?.owner}`);
    }
  }
  // Code statistics are a bounded diagnostic, not a heap attribution oracle.
  // A caller needs non-native compiled-code/feedback heap attribution as well;
  // absent attribution leaves *all* positive heap growth unexplained.
  const code = evidence.compiledCode;
  const validSamples = samples.length >= 2 && samples.every(row => valid(row?.heapUsedBytes) && valid(row?.nativeBytes));
  let heapGrowthBytes = null;
  if (validSamples) {
    let minimum = first.heapUsedBytes;
    heapGrowthBytes = 0;
    // Compare every checkpoint with its preceding minimum: an earlier peak or
    // decrease must not hide growth within either raw repeat phase.
    for (const sample of samples) {
      heapGrowthBytes = Math.max(heapGrowthBytes, sample.heapUsedBytes - minimum);
      minimum = Math.min(minimum, sample.heapUsedBytes);
    }
  }
  const validCode = record(code) && valid(code.heapGrowthBytes) && code.heapGrowthBytes <= COMPILED_CODE_ALLOWANCE_BYTES
    && code.source === 'non-native-code-feedback-spot-check';
  if ((heapGrowthBytes !== null && heapGrowthBytes > 0 || code != null) && !validCode) reasons.push('compiled-code-attribution-unavailable-or-over-bound');
  if (!valid(heapGrowthBytes) || heapGrowthBytes > (validCode ? code.heapGrowthBytes : 0)) reasons.push('residual-heap-growth');
  return { eligible: reasons.length === 0, reasons: [...new Set(reasons)], heapGrowthBytes,
    compiledCodeAllowanceBytes: COMPILED_CODE_ALLOWANCE_BYTES,
    // Signed end-to-end native delta is diagnostic only, never waiver headroom.
    nativeGrowthBytes: validSamples ? last.nativeBytes - first.nativeBytes : null,
    interpretation: 'All owner ledgers must be enforced, warmed and flat. Native/backing bytes cannot offset heap growth. Missing proof preserves every raw growth gate.' };
}
