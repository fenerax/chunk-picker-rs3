import { parseArgs } from 'node:util';
import { digest } from './model.mjs';

export function memoryProfile(value = 'default') {
  if (!['default', 'budget-672'].includes(value)) throw new TypeError('Use --memory-profile default or budget-672.');
  return value;
}

export function parseRunOptions(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    profile: { type: 'string', default: 'smoke' }, output: { type: 'string' }, host: { type: 'string', default: '127.0.0.1' },
    'fixture-workers': { type: 'string' }, 'fixture-from': { type: 'string' }, 'fixture-only': { type: 'boolean', default: false },
    format: { type: 'string', default: 'format1' }, 'memory-profile': { type: 'string', default: 'default' },
  } });
  memoryProfile(values['memory-profile']);
  return values;
}

// Keep the runner's OS-only allowlist. Profile selection travels in profile.json.
export const childEnvironment = (env = process.env) => Object.fromEntries(Object.entries(env)
  .filter(([key]) => /^(PATH|SystemRoot|WINDIR|TEMP|TMP|HOME|USERPROFILE|COMSPEC|PATHEXT)$/i.test(key)));

export function configureMemoryProfile(value, env = process.env) {
  const selected = memoryProfile(value);
  for (const key of Object.keys(env)) if (key.startsWith('RS3_')) delete env[key];
  if (selected === 'budget-672') env.RS3_MEMORY_PROFILE = selected;
  return selected;
}

export const runManifest = ({ profile, format, sourceCommit, sourceTreeDigest, node = process.version, verification,
  fixtureReuse = null, fixtureDigest = null }) => ({
  schemaVersion: 1, sourceCommit, sourceTreeDigest, node, format,
  fixtureReuse, fixtureDigest,
  requestedMemoryProfile: memoryProfile(profile.requestedMemoryProfile ?? profile.memoryProfile),
  memoryProfile: verification?.status === 'pass' ? verification.memoryProfile : null,
  memoryProfileVerification: verification ?? { status: 'unverified', availability: 'unavailable' },
  profileDigest: digest(profile),
});

// Only server HTTP output can prove application. Never call the environment-based
// serviceMemoryBudget() factory here: it would only repeat the requested setting.
export function verifyMemoryProfile(requested, health, diagnostics) {
  const selected = memoryProfile(requested), evidence = [];
  for (const [source, summary] of [
    ['health.memoryBudget', health?.memoryBudget], ['health.service.memoryBudget', health?.service?.memoryBudget],
    ['diagnostics.memoryBudget', diagnostics?.memoryBudget], ['diagnostics.service.memoryBudget', diagnostics?.service?.memoryBudget],
  ]) if (summary !== undefined && summary !== null) evidence.push({ source, summary });
  const valid = selected === 'budget-672'
    ? evidence.length > 0 && evidence.every(({ summary }) => summary.profile === selected && summary.enforced === true)
    : evidence.every(({ summary }) => summary.enforced === false);
  return { status: valid ? 'pass' : 'fail', ...(valid ? {} : { reason: 'memory-profile-unverified' }),
    requestedMemoryProfile: selected, memoryProfile: valid ? selected : null,
    availability: evidence.length ? 'available' : 'unavailable', evidence };
}

export function requireMemoryProfile(verification) {
  if (verification?.status !== 'pass') throw Object.assign(new Error('memory-profile-unverified: server HTTP output does not prove the requested memory profile.'),
    { code: 'memory-profile-unverified', verification: verification ?? { status: 'fail', reason: 'memory-profile-unverified', memoryProfile: null, availability: 'unavailable' } });
  return verification;
}

export async function verifyServerMemoryProfile(requested, get) {
  let health, diagnostics;
  try { [health, diagnostics] = await Promise.all(['/api/health', '/api/diagnostics'].map(get)); }
  catch { return requireMemoryProfile({ ...verifyMemoryProfile(requested), status: 'fail', memoryProfile: null, reason: 'memory-profile-unverified' }); }
  return requireMemoryProfile(verifyMemoryProfile(requested, health, diagnostics));
}

export function evaluateMemoryProfile(result) {
  const selected = memoryProfile(result.memoryProfile), generations = new Map();
  const failure = evidence => ({ ...verifyMemoryProfile(selected), status: 'fail', memoryProfile: null,
    reason: 'memory-profile-unverified', evidence });
  // An absent summary means "unavailable" only when this server generation's
  // health and diagnostics were both actually received; no receipt, no verdict.
  const observed = (server, generation) => ['health', 'diagnostics'].every(name => {
    const receipt = server[`${name}Observation`];
    return server[name] && typeof server[name] === 'object' && receipt?.serverId === server.serverId && receipt.generation === generation;
  });
  for (const row of result.samples ?? []) if (row.server) {
    const server = row.server, verification = verifyMemoryProfile(selected, server.health, server.diagnostics);
    const evidence = { generation: row.generation, serverId: server.serverId,
      healthObservation: server.healthObservation, diagnosticsObservation: server.diagnosticsObservation, ...verification };
    if (verification.status === 'fail') return failure([evidence]);
    for (const { source } of verification.evidence) {
      const receipt = source.startsWith('health.') ? server.healthObservation : server.diagnosticsObservation;
      if (!receipt || receipt.serverId !== server.serverId || receipt.generation !== row.generation) return failure([evidence]);
    }
    if (verification.availability !== 'available' && !observed(server, row.generation)) continue;
    if (!generations.has(server.serverId) || verification.availability === 'available') generations.set(server.serverId, evidence);
  }
  const expected = [result.load?.initialServerId, ...(result.load?.restarts ?? []).map(row => row.serverId)];
  if (expected.some(id => !id || !generations.has(id))) return failure([...generations.values()]);
  return { status: 'pass', requestedMemoryProfile: selected, memoryProfile: selected,
    availability: [...generations.values()].some(row => row.availability === 'available') ? 'available' : 'unavailable',
    evidence: [...generations.values()] };
}

// These are observed HTTP summaries, never inferred from the requested profile.
// Main exposes calculator cache limits but no complete service memory budget.
export function effectiveCaps(health, diagnostics) {
  const summaries = {};
  const visit = (value, prefix) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    for (const [key, child] of Object.entries(value)) {
      const location = `${prefix}.${key}`;
      if (/memory|cache/i.test(key) && child !== null && child !== undefined) summaries[location] = child;
      else visit(child, location);
    }
  };
  visit(health, 'health'); visit(diagnostics, 'diagnostics');
  return { status: Object.keys(summaries).length ? 'available' : 'unavailable', summaries };
}

export function assertMemoryProfile(result) {
  const selected = memoryProfile(result.memoryProfile);
  const check = (row, where) => {
    if (row?.memoryProfile !== selected) throw new Error(`Memory profile mismatch at ${where}: expected ${selected}, got ${row?.memoryProfile ?? 'unlabelled'}. Cannot combine memory profiles into one verdict.`);
  };
  // The requested selection must agree with the applied label wherever it is recorded.
  const requested = (row, where) => {
    if (row?.requestedMemoryProfile !== undefined && row.requestedMemoryProfile !== selected) throw new Error(`Memory profile mismatch at ${where}: requested ${row.requestedMemoryProfile}, applied ${selected}. Cannot combine memory profiles into one verdict.`);
  };
  check(result, 'result'); check(result.profile, 'profile'); check(result.load, 'load');
  requested(result, 'result'); requested(result.profile, 'profile');
  if (result.manifest) { check(result.manifest, 'manifest'); requested(result.manifest, 'manifest'); }
  for (const key of ['operations', 'offeredOperations', 'coldOpens', 'restarts', 'streamHandshakes', 'commands', 'stageStreams'])
    for (const row of result.load[key] ?? []) check(row, `load.${key}`);
  if (result.load.tailStreams) check(result.load.tailStreams, 'load.tailStreams');
  for (const key of ['groups', 'streams']) for (const row of result.load.recovery?.[key] ?? []) check(row, `recovery.${key}`);
  for (const row of result.samples ?? []) {
    check(row, 'sample');
    if (row.server) {
      check(row.server, 'sample.server');
      for (const key of ['healthObservation', 'diagnosticsObservation'])
        if (row.server[key]) check(row.server[key], `sample.server.${key}`);
    }
  }
  for (const key of ['contextOpens', 'admissionTransitions']) for (const row of result[key] ?? []) check(row, key);
  return selected;
}

export function memoryProfileMarkdown(result) {
  const selected = assertMemoryProfile(result), verification = evaluateMemoryProfile(result), generations = new Map();
  for (const row of result.samples ?? []) if (row.server && !generations.has(row.generation)) {
    generations.set(row.generation, { requestedMemoryProfile: selected, memoryProfile: verification.memoryProfile, generation: row.generation, serverId: row.server.serverId,
      healthObservation: row.server.healthObservation, diagnosticsObservation: row.server.diagnosticsObservation,
      effectiveCaps: row.server.effectiveCaps ?? { status: 'unavailable', summaries: {} } });
  }
  return (verification.status === 'pass' ? `Memory profile: **${selected}**. Each verdict applies only to this profile.\n\n`
    : `Memory profile: **unverified**; requested \`${selected}\`. Reason: **memory-profile-unverified**. No speed verdict establishes this profile.\n\n`) +
    `## Effective caps evidence\n\nObserved health/diagnostics memory and cache summaries, once per server generation; all observations remain in samples.jsonl. Missing summaries are unavailable. Cache usage alone does not establish a service budget or prove the requested profile is implemented.\n\n` +
    '```json\n' + JSON.stringify(generations.size ? [...generations.values()] : { status: 'unavailable' }, null, 2) + '\n```\n\n';
}
