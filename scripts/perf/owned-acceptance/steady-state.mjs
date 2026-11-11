// Ledger-first rule: owner decision, 2026-11-11. Charges are in their source
// units, never estimates to subtract from heapUsed, external, or arrayBuffers.
export const allowedOwners = Object.freeze(['History', 'response-caches', 'hot-snapshot', 'engine-variants', 'stateSnapshots']);
export const COMPILED_CODE_ALLOWANCE_BYTES = 1024 * 1024; // Whole process tree, not per group/round.
const valid = value => Number.isSafeInteger(value) && value >= 0;
const key = row => `${row.owner}/${row.id}`;

export function inspectLedgers(owners) {
  const reasons = [], keys = new Set();
  for (const row of owners) {
    if (keys.has(key(row))) reasons.push(`duplicate-ledger:${key(row)}`);
    keys.add(key(row));
    if (!allowedOwners.includes(row.owner)) reasons.push(`unlisted-owner:${row.owner}`);
    if (!row.complete) reasons.push(`incomplete-owner:${key(row)}:${(row.blockers ?? []).join(',')}`);
    if (!row.dimensions?.length) reasons.push(`missing-cap:${key(row)}`);
    for (const dimension of row.dimensions ?? []) {
      if (!valid(dimension.used) || !valid(dimension.cap) || dimension.enforced !== true)
        reasons.push(`unenforced-cap:${key(row)}/${dimension.unit}`);
      else if (dimension.used > dimension.cap) reasons.push(`owner-over-cap:${key(row)}/${dimension.unit}`);
    }
  }
  for (const owner of allowedOwners) if (!owners.some(row => row.owner === owner)) reasons.push(`missing-owner:${owner}`);
  return reasons;
}

// A cycle must name its actual admissions/finite working set. No guessed round
// count, or observed-below-cap flag, can establish that an owner was warmed.
export function warmupPlan(owners) {
  const blockers = inspectLedgers(owners), plans = [];
  for (const row of owners) {
    const workload = row.workload;
    const entryCap = row.dimensions?.find(d => d.unit === 'entries' && d.enforced)?.cap;
    if (!workload || !valid(workload.newEntriesPerCycle) || workload.newEntriesPerCycle === 0 || !valid(entryCap)) {
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
  const missing = owners.filter(row => !row.complete || !row.dimensions?.some(d => d.unit === 'chargeBytes' && valid(d.cap) && d.enforced)).map(key);
  const sum = scope => owners.filter(row => row.scope === scope && !row.includedInOtherCap).reduce((total, row) => total
    + (row.dimensions?.find(d => d.unit === 'chargeBytes' && valid(d.cap) && d.enforced)?.cap ?? 0), 0);
  const perGroup = sum('group') / Math.max(1, new Set(owners.filter(row => row.scope === 'group').map(row => row.group)).size);
  const shared = sum('shared');
  return { diagnosticOnly: true, complete: missing.length === 0, missingByteCaps: missing,
    perGroupByteCapSum: missing.length ? null : perGroup,
    projectedTotal100GroupBytes: missing.length ? null : perGroup * 100 + shared,
    knownPerGroupByteCapSubtotal: perGroup, knownSharedByteCapSubtotal: shared,
    knownProjected100GroupByteCapSubtotal: perGroup * 100 + shared,
    note: 'Source ledger charge units; incomplete totals are null, never zero. No heap subtraction or new threshold.' };
}

// Spot checks can veto a proof, never establish missing caps or warm-up. Native
// growth is retained in the report but is intentionally absent from this math.
export function steadyStateRule(evidence) {
  const reasons = [];
  if (!evidence) return { eligible: false, reasons: ['ledger-evidence-missing; raw-growth-gates-apply'] };
  if (evidence.uncoveredMaximum) reasons.push('uncovered-maximum');
  if (evidence.warmup?.status !== 'reached') reasons.push('warmup-not-reached');
  const samples = evidence.samples ?? [];
  if (samples.length < 2) reasons.push('insufficient-steady-samples');
  let inventory;
  for (const sample of samples) {
    reasons.push(...inspectLedgers(sample.owners ?? []));
    const current = JSON.stringify((sample.owners ?? []).map(row => [key(row), row.scope,
      row.dimensions?.map(d => [d.unit, d.cap])]).sort());
    if (inventory !== undefined && current !== inventory) reasons.push('ledger-inventory-changed');
    inventory = current;
  }
  const first = samples[0], last = samples.at(-1);
  const plan = warmupPlan(first?.owners ?? []);
  reasons.push(...plan.blockers);
  for (const reached of evidence.warmup?.owners ?? []) {
    const required = plan.owners.find(row => key(row) === key(reached));
    if (!['cap', 'enumerated-working-set'].includes(reached.basis) || !valid(reached.requiredEntries)
      || reached.requiredEntries !== required?.entries || reached.attainedEntries < reached.requiredEntries || reached.asserted !== true)
      reasons.push(`warmup-unasserted:${reached.owner}/${reached.id}`);
  }
  for (const row of first?.owners ?? []) {
    if (!evidence.warmup?.owners?.some(w => key(w) === key(row))) reasons.push(`owner-not-warmed:${key(row)}`);
    // Flat in every source dimension, not a net positive/negative cancellation
    // between owners or a JSON-byte-to-V8 conversion.
    for (const dimension of row.dimensions ?? []) if (samples.some(sample =>
      sample.owners.find(other => key(other) === key(row))?.dimensions.find(d => d.unit === dimension.unit)?.used !== dimension.used))
      reasons.push(`nonflat-ledger:${key(row)}/${dimension.unit}`);
  }
  for (const spot of evidence.spotChecks ?? []) {
    if (spot.uncoveredMaximum) reasons.push('uncovered-maximum');
    if (spot.unattributedHeapGrowthBytes > 0) reasons.push('spot-check-unattributed-heap');
    for (const owner of spot.owners ?? []) {
      if (![...allowedOwners, 'compiled-code-feedback'].includes(owner.owner)) reasons.push(`unlisted-owner:${owner.owner}`);
      if (!valid(owner.cap) || !valid(owner.used) || owner.used > owner.cap) reasons.push(`spot-check-owner-over-cap:${owner.owner}`);
    }
  }
  // Code statistics are a bounded diagnostic, not a heap attribution oracle.
  // A caller needs non-native compiled-code/feedback heap attribution as well;
  // absent attribution leaves *all* positive heap growth unexplained.
  const code = evidence.compiledCode;
  const heapGrowthBytes = first && last ? Math.max(...samples.map(row => row.heapUsedBytes - first.heapUsedBytes)) : null;
  if ((heapGrowthBytes > 0 || code) && (!code || !valid(code.heapGrowthBytes) || code.heapGrowthBytes > COMPILED_CODE_ALLOWANCE_BYTES
    || code.source !== 'non-native-code-feedback-spot-check')) reasons.push('compiled-code-attribution-unavailable-or-over-bound');
  if (!valid(heapGrowthBytes) || heapGrowthBytes > (code?.heapGrowthBytes ?? 0)) reasons.push('residual-heap-growth');
  return { eligible: reasons.length === 0, reasons: [...new Set(reasons)], heapGrowthBytes,
    compiledCodeAllowanceBytes: COMPILED_CODE_ALLOWANCE_BYTES,
    nativeGrowthBytes: first && last ? last.nativeBytes - first.nativeBytes : null,
    interpretation: 'All owner ledgers must be enforced, warmed and flat. Native/backing bytes cannot offset heap growth. Missing proof preserves every raw growth gate.' };
}
