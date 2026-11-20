// Bounded histograms: percentiles use a conservative upper bucket (~1% error).
export class Histogram {
  buckets = new Map(); count = 0; maxMs = 0;
  add(ms) { if (!Number.isFinite(ms)) return; ms = Math.max(0, ms); const bin = Math.ceil(Math.log1p(ms) / Math.log(1.01));
    this.buckets.set(bin, (this.buckets.get(bin) ?? 0) + 1); this.count++; this.maxMs = Math.max(this.maxMs, ms); }
  json() {
    const rows = [...this.buckets].sort(([a], [b]) => a - b);
    const p = n => { if (!this.count) return null; let total = 0; for (const [bin, count] of rows) { total += count;
      if (total >= Math.ceil(n * this.count)) return Math.min(this.maxMs, Math.expm1(bin * Math.log(1.01))); } };
    return { count: this.count, p50Ms: p(.5), p95Ms: p(.95), p99Ms: p(.99), maxMs: this.count ? this.maxMs : null };
  }
}
export function phaseMetrics() {
  return { offered: 0, completed: 0, drops: 0, requests: 0, refusals: 0, timeouts: 0, failures: 0, conflicts: 0,
    missingRetryAfter: 0, streamAttempts: 0, streamOpened: 0, streamRefused: 0, streamFailures: 0, streamEnds: 0, capacityStreamEvictions: 0,
    actions: {}, operations: {}, http: new Histogram(), arrival: new Histogram(), queue: new Histogram(),
    acknowledgement: new Histogram(), propagation: new Histogram(), samples: 0, loopMaxP99Ms: 0, rssPeak: 0, swapPeak: 0, cpuSeconds: 0, sampledSeconds: 0,
    treeSupported: true };
}
export function summarize(row) {
  const value = { ...row };
  for (const key of ['http', 'arrival', 'queue', 'acknowledgement', 'propagation']) value[key] = row[key].json();
  value.operations = Object.fromEntries(Object.entries(row.operations).map(([key, h]) => [key, h.json()]));
  value.httpByOperation = Object.fromEntries(Object.entries(row.httpByOperation ?? {}).map(([key, h]) => [key, h.json()]));
  return value;
}
const timing = (h, p95, p99) => !h.count ? 'unmeasured' : h.p95Ms <= p95 && h.p99Ms <= p99 ? 'pass' : 'fail';
export function gates(phases, isolation, audit, pendingEvents, hardware, c) {
  const result = {};
  for (const [name, row] of Object.entries(phases)) {
    const cpuLimit = row.cpuCapacity ?? hardware.logicalCpus;
    const warm = new Histogram(), expensive = new Histogram(), cold = new Histogram(), switches = new Histogram();
    for (const [op, h] of Object.entries(row.operations)) {
      if (['isolation', 'sync', 'phase'].includes(op)) continue;
      const target = op.startsWith('expensive:') ? expensive : op.startsWith('cold:') ? cold : op.startsWith('switch:') ? switches : warm;
      for (const [bin, count] of h.buckets) target.buckets.set(bin, (target.buckets.get(bin) ?? 0) + count);
      target.count += h.count; target.maxMs = Math.max(target.maxMs, h.maxMs);
    }
    result[name] = {
      cheapWarm: timing(warm.json(), 1000, 2000), expensive: timing(expensive.json(), 3000, 8000),
      cold: row.coldReadinessFailures ? 'fail' : timing(cold.json(), 15000, 30000), switch: timing(switches.json(), 2000, 5000),
      acknowledgement: timing(row.acknowledgement.json(), 1000, 2000), propagation: timing(row.propagation.json(), 1000, 2000),
      nominalAdmission: ['overload', 'cold', 'restart'].includes(name) ? 'not-applicable' : row.requests && (row.refusals - (row.intentionalRefusals ?? 0) + row.timeouts + row.failures + row.drops + row.streamRefused + row.streamFailures + (row.actionFailures ?? 0)) / (row.requests - (row.intentionalRequests ?? 0) + row.streamAttempts) < .001 ? 'pass' : 'fail',
      healthyStreams: row.capacityStreamEvictions || row.streamEnds ? 'fail' : row.streamOpened || row.observedStreams ? 'pass' : 'unmeasured',
      resourceHeadroom: !row.samples || !row.sampledSeconds || !row.treeSupported || row.sampleErrors ? 'unmeasured' :
        row.cpuSeconds / Math.max(.001, row.sampledSeconds) / cpuLimit <= .65 && row.loopMaxP99Ms <= 50 &&
        row.rssPeak < .8 * Math.max(0, (row.memoryCapacity ?? hardware.physicalRAMBytes) - c['os-reserve-mib'] * 1024 * 1024) && row.swapPeak === 0 ? 'pass' : 'fail',
      overloadRefusals: name === 'overload' ? row.missingRetryAfter === 0 && !row.timeouts && !row.failures ? 'pass' : 'fail' : 'not-applicable',
    };
  }
  return { phases: result, isolationAndDurability: isolation.length || !audit.passed || pendingEvents ? 'fail' : audit.acknowledgedWrites || audit.pluginAcknowledgedEvents ? 'pass' : 'unmeasured',
    acceptance: 'unproven',
    unmeasured: ['usable-screen/render time', 'wrong-dataset restore', 'off-site RPO and clean-host/group restore',
      'five-minute overload recovery unless a full recovery interval is run', 'fairness/disk-growth/OOM analysis',
      'three independent 60-minute trials plus 12–24-hour soak required for acceptance'],
  };
}
