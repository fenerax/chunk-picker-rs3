import { sampleCounts, countSample, sampleReceiptStatus, sampleCountsMarkdown } from './sample-verification.mjs';

// Scratch-only selections. Application defaults remain owned by the router,
// picker limits and admission modules; default injects no overrides.
export function residency(value = 'default') {
  if (!['default', 'trial'].includes(value)) throw new TypeError('Use --residency default or trial.');
  return value;
}

export function residencyValues(value) {
  const trial = residency(value) === 'trial';
  return { maxOpenContexts: trial ? 128 : 7, idleCloseMs: 600000, coldStartsPerAccount: 1, coldStartsGlobal: trial ? 4 : 1,
    coldAdmission: { maxPending: trial ? 256 : 64, perAccount: 2, deadlineMs: trial ? 30000 : 2000 } };
}

export function residencyOptions(value) {
  if (residency(value) === 'default') return {};
  const { coldAdmission, ...options } = residencyValues(value);
  return { ...options, coldOpenAdmission: coldAdmission };
}

export function verifyResidency(requested, diagnostics) {
  const selected = residency(requested), expected = residencyValues(selected), observed = diagnostics?.residency ?? null;
  const matches = (want, got) => got && Object.entries(want).every(([key, value]) =>
    typeof value === 'object' ? matches(value, got[key]) : got[key] === value);
  const valid = Boolean(matches(expected, observed));
  return { status: valid ? 'pass' : 'fail', ...(valid ? {} : { reason: 'residency-unverified' }),
    requestedResidency: selected, residency: valid ? selected : null, expected, observed };
}

export function requireResidency(verification) {
  if (verification?.status !== 'pass') throw Object.assign(new Error('residency-unverified: server diagnostics do not prove the requested residency limits.'),
    { code: 'residency-unverified', verification: verification ?? { status: 'fail', reason: 'residency-unverified', residency: null, observed: null } });
  return verification;
}

export function verifyResidencySample(requested, diagnostics) {
  const proof = verifyResidency(requested, diagnostics);
  return diagnostics == null ? { ...proof, status: 'unverified' } : proof;
}

export async function verifyServerResidency(requested, get) {
  let diagnostics;
  try { diagnostics = await get('/api/diagnostics'); } catch { /* Missing evidence fails closed below. */ }
  return requireResidency(verifyResidency(requested, diagnostics));
}

export const residencyManifest = (profile, verification) => ({
  requestedResidency: residency(profile.requestedResidency ?? profile.residency),
  residency: verification?.status === 'pass' ? verification.residency : null,
  residencyVerification: verification ?? { status: 'unverified', observed: null },
});

// Old, unlabelled artifacts remain default-only. Once a run has an explicit
// selection every workload/telemetry row must carry it; never mix trial rows.
export function assertResidency(result) {
  const selected = residency(result.residency ?? result.requestedResidency), explicit = result.requestedResidency !== undefined;
  const check = (row, where) => {
    if (!row || (row.residency === undefined && !explicit && selected === 'default')) return;
    if (row.residency !== selected || row.requestedResidency !== undefined && row.requestedResidency !== selected)
      throw new Error(`Residency mismatch at ${where}. Cannot combine residency settings into one verdict.`);
  };
  check(result, 'result'); check(result.profile, 'profile'); check(result.load, 'load');
  if (result.manifest) check(result.manifest, 'manifest');
  for (const key of ['operations', 'offeredOperations', 'coldOpens', 'restarts', 'streamHandshakes', 'commands', 'stageStreams'])
    for (const row of result.load?.[key] ?? []) check(row, `load.${key}`);
  if (result.load?.tailStreams) check(result.load.tailStreams, 'load.tailStreams');
  for (const key of ['groups', 'streams']) for (const row of result.load?.recovery?.[key] ?? []) check(row, `recovery.${key}`);
  for (const row of result.samples ?? []) {
    check(row, 'sample');
    if (row.server) {
      check(row.server, 'sample.server');
      for (const key of ['healthObservation', 'diagnosticsObservation']) if (row.server[key]) check(row.server[key], key);
    }
  }
  for (const key of ['contextOpens', 'admissionTransitions']) for (const row of result[key] ?? []) check(row, key);
  return selected;
}

export function evaluateResidency(result) {
  const selected = assertResidency(result), evidence = new Map(), samples = sampleCounts(), mismatches = [];
  for (const row of result.samples ?? []) {
    const { server } = row, proof = verifyResidencySample(selected, server?.diagnostics);
    const status = proof.status === 'pass' ? sampleReceiptStatus(row, 'diagnostics') : proof.status;
    countSample(samples, row, status);
    if (status === 'fail') mismatches.push({ generation: row.generation, serverId: server?.serverId, ...proof });
    if (status === 'pass' && row.measured === true)
      evidence.set(server.serverId, { generation: row.generation, serverId: server.serverId, ...proof });
  }
  const expected = [result.load?.initialServerId, ...(result.load?.restarts ?? []).map(row => row.serverId)];
  const valid = samples.mismatched === 0 && samples.measured.verified > 0 && expected.every(id => id && evidence.has(id));
  return { status: valid ? 'pass' : 'fail', ...(valid ? {} : { reason: 'residency-unverified' }),
    requestedResidency: selected, residency: valid ? selected : null, samples, evidence: [...mismatches, ...evidence.values()] };
}

export function residencyMarkdown(result) {
  const selected = assertResidency(result), proof = evaluateResidency(result);
  return `Residency: **${proof.residency ?? 'unverified'}**; requested \`${selected}\`. Each verdict applies only to this residency and memory selection.\n\n` +
    sampleCountsMarkdown('Residency', proof.samples) +
    'Observed residency limits by server generation:\n\n```json\n' + JSON.stringify(proof, null, 2) + '\n```\n\n';
}
