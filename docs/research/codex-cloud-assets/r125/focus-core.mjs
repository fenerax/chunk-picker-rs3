// Source-only helpers: imports perform no process, application or browser work.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pickWitness } from './tests/task-focus-native.observers.mjs';
import { projectDiagnostic } from './focus-diagnostics.mjs';
import { projectNativeDiagnostic } from './focus-native-evidence.mjs';
import { projectTabDiagnostic } from './focus-tab-evidence.mjs';
export const PROTOCOL = 'docker-hard-2cpu-6g-v1';
export const PIN = '6f22fefa782747790e2eaefa01e4e5ea7b557323';
export const IMAGE = 'mcr.microsoft.com/playwright:v1.62.1-noble@sha256:c091b21d9fae78c76e85cd4356431e9b018402f172a214fc7d7a5e9a7e29d8ac';
export const CASE = 'native later-page focus across held ack: group=false, owner=alpha';
export const FOCUS_FLAGS = ['passed', 'cleanupPassed', 'nativeAssertionsPassed', 'freshBodyJoinPassed', 'cachedFallbackPassed', 'realSlicePassed',
  'trustedSpacePassed', 'commandHistoryPassed', 'persistedOwnerReadbackPassed', 'fixtureDrainPassed', 'controllerDrainPassed', 'originalSourceUnchanged'];
export const STAGES = new Set(['start', 'overlay-ready', 'episode-start', 'episode-end', 'cleanup-start', 'cleanup-end', 'result', 'error']);
export const ensure = (condition, code) => { if (!condition) { const error = new Error(code); error.code = code; throw error; } };
export const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const blob = bytes => crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
export function fileSha(filename) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { const hash = crypto.createHash('sha256'), data = Buffer.alloc(1048576); let n;
    while ((n = fs.readSync(fd, data, 0, data.length, null))) hash.update(data.subarray(0, n)); return hash.digest('hex');
  } finally { fs.closeSync(fd); }
}
export function safeRelative(name) {
  ensure(typeof name === 'string' && /^[A-Za-z0-9_./-]+$/.test(name) && !name.startsWith('/')
    && name.split('/').every(part => part && !['.', '..', '.git', '.env'].includes(part)), 'unsafe-source-path'); return name;
}
export function sourceTree(directory) {
  const rows = [];
  function visit(folder, relative = '') {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const name = relative ? relative + '/' + entry.name : entry.name;
      if (name.split('/').includes('.git')) continue;
      ensure(!entry.isSymbolicLink(), 'source-symlink');
      if (entry.isDirectory()) visit(path.join(folder, entry.name), name);
      else { ensure(entry.isFile(), 'source-special-file'); rows.push([name, fileSha(path.join(folder, entry.name))]); }
    }
  }
  visit(directory); rows.sort((a, b) => Buffer.compare(Buffer.from(a[0]), Buffer.from(b[0])));
  const hash = crypto.createHash('sha256'); for (const [name, digest] of rows) hash.update(name + '\0').update(Buffer.from(digest, 'hex'));
  return { files: rows.length, sha256: hash.digest('hex'), rows };
}
export function verifyTree(tree, expected) {
  ensure(tree.files === expected.files && tree.sha256 === expected.sha256, 'public-source-tree-mismatch');
}
export function verifySourceLock(lock, tree) {
  ensure(lock.schemaVersion === 1 && lock.sourceCommit === PIN && lock.files?.length === tree.files, 'source-lock-mismatch');
  const actual = new Map(tree.rows);
  ensure(new Set(lock.files.map(row => row.path)).size === tree.files
    && lock.files.every(row => actual.get(row.path) === row.sha256), 'source-lock-content-mismatch');
  ensure(sha(Buffer.from(JSON.stringify(lock.files))) === lock.manifestSha256, 'source-lock-digest-mismatch');
}

// Exact, no-fuzz Node-only installer. No git, patch, Python or shell dependency.
export function applyUnifiedPatch(text, inputs, expectedHashes) {
  ensure(Buffer.byteLength(text) < 262144 && !text.includes('\r'), 'patch-encoding');
  const lines = text.split('\n'); if (lines.at(-1) === '') lines.pop();
  let i = 0; const outputs = new Map();
  while (i < lines.length) {
    const header = /^diff --git a\/(\S+) b\/(\S+)$/.exec(lines[i++]);
    ensure(header && header[1] === header[2], 'patch-file-header'); const name = safeRelative(header[1]);
    ensure(!outputs.has(name) && Object.hasOwn(expectedHashes, name), 'patch-path-not-admitted');
    let added = false, index, oldName, newName;
    while (i < lines.length && !lines[i].startsWith('@@ ')) {
      const line = lines[i++];
      if (line === 'new file mode 100644') added = true;
      else if (line.startsWith('index ')) { ensure(!index, 'patch-duplicate-index'); index = /^index ([0-9a-f]+)\.\.([0-9a-f]+)(?: 100644)?$/.exec(line); ensure(index, 'patch-index'); }
      else if (line.startsWith('--- ')) oldName = line.slice(4);
      else if (line.startsWith('+++ ')) newName = line.slice(4);
      else ensure(false, 'patch-extra-header');
    }
    ensure(index && newName === 'b/' + name && oldName === (added ? '/dev/null' : 'a/' + name), 'patch-file-names');
    const prior = inputs.get(name); ensure(added ? prior === undefined && /^0+$/.test(index[1]) : Buffer.isBuffer(prior) && blob(prior).startsWith(index[1]), 'patch-base-identity');
    const oldText = prior?.toString('utf8') ?? ''; ensure(!oldText || oldText.endsWith('\n'), 'patch-base-newline');
    const original = oldText ? oldText.slice(0, -1).split('\n') : [], output = []; let cursor = 0, hunks = 0;
    while (i < lines.length && lines[i].startsWith('@@ ')) {
      const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(lines[i++]); ensure(hunk, 'patch-hunk'); hunks++;
      const oldStart = Number(hunk[1]), oldCount = hunk[2] === undefined ? 1 : Number(hunk[2]);
      const newStart = Number(hunk[3]), newCount = hunk[4] === undefined ? 1 : Number(hunk[4]);
      const target = oldCount === 0 ? oldStart : oldStart - 1;
      ensure(target >= cursor && target <= original.length, 'patch-hunk-range'); output.push(...original.slice(cursor, target)); cursor = target;
      ensure(output.length === (newCount === 0 ? newStart : newStart - 1), 'patch-new-range');
      let before = 0, after = 0;
      while (before < oldCount || after < newCount) {
        ensure(i < lines.length, 'patch-truncated-hunk'); const line = lines[i++], kind = line[0], content = line.slice(1);
        ensure([' ', '+', '-'].includes(kind), 'patch-hunk-line');
        if (kind !== '+') { ensure(before < oldCount && original[cursor++] === content, 'patch-context-mismatch'); before++; }
        if (kind !== '-') { ensure(after < newCount, 'patch-add-count'); output.push(content); after++; }
      }
    }
    ensure(hunks > 0, 'patch-no-hunks'); output.push(...original.slice(cursor)); const bytes = Buffer.from(output.join('\n') + '\n');
    ensure(blob(bytes).startsWith(index[2]) && sha(bytes) === expectedHashes[name], 'patch-output-identity'); outputs.set(name, bytes);
  }
  return outputs;
}

export function nativeEnvironment(env, workspace) {
  ensure(env.NODE_PATH === '/deps/node_modules', 'wrapper-node-path');
  ensure(!env.NODE_OPTIONS && !env.NODE_V8_COVERAGE, 'unadmitted-node-hook');
  ensure(env.PERF_STAGE_FD === '3' && env.PERF_SOURCE_ROOT === '/source' && env.PERF_HARNESS_ROOT === '/harness'
    && env.PERF_OUTPUT_ROOT === '/scratch' && env.PERF_CASE_RESULT === '/scratch/case-result.json', 'wrapper-path-contract');
  ensure(env.PLAYWRIGHT_BROWSERS_PATH === '/ms-playwright' && env.PERF_PLAYWRIGHT_MODULE === 'file:///deps/node_modules/playwright/index.mjs', 'wrapper-dependency-contract');
  ensure(!Object.keys(env).some(key => key.startsWith('RS3_')), 'unexpected-application-selector');
  const child = { ...env };
  for (const key of Object.keys(child)) if (key.startsWith('NODE_TEST_') || key.startsWith('R78_')
    || ['NODE_PATH', 'NODE_CHANNEL_FD', 'NODE_CHANNEL_SERIALIZATION_MODE'].includes(key)) delete child[key];
  return { ...child, R78_NATIVE: '1', R78_PLAYWRIGHT: '/deps/node_modules/playwright/index.mjs',
    R78_CHROMIUM: '/ms-playwright/chromium-1234/chrome-linux64/chrome', R78_SCRATCH: workspace + '/fixture-',
    RS3_DATASET: 'duo-legacy', RS3_TASK_WORKER_MODE: 'process', NODE_DISABLE_COLORS: '1' };
}
export function nativeArguments() {
  return ['--max-old-space-size=768', '--test-reporter=spec', '--test-name-pattern=^' + CASE + '$', 'tests/task-focus-native-v4.test.mjs'];
}

export function parseNativeEvidence(raw, code, signal = null) {
  ensure(Buffer.byteLength(raw) <= 1048576 && code === 0 && signal === null, 'native-exit-or-output');
  const text = raw.replace(/\x1b\[[0-9;]*m/g, ''), escaped = CASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  ensure((text.match(new RegExp('^✔ ' + escaped + ' \\(', 'gm')) ?? []).length === 1, 'named-native-pass');
  for (const [name, n] of [['tests', 1], ['pass', 1], ['fail', 0], ['cancelled', 0], ['skipped', 0]]) ensure(new RegExp('^ℹ ' + name + ' ' + n + '\\s*$', 'm').test(text), 'actual-native-counts');
  const tags = {};
  for (const tag of ['r109-native-witness', 'r109-command-proof', 'r109-fixture-drain']) {
    const rows = text.split('\n').filter(line => line.startsWith(tag + ' ')); ensure(rows.length === 1, 'native-evidence-cardinality');
    tags[tag] = JSON.parse(rows[0].slice(tag.length + 1));
  }
  const evidence = tags['r109-native-witness'], proof = tags['r109-command-proof'], drain = tags['r109-fixture-drain'];
  ensure(evidence.owner === 'alpha' && evidence.group === false && proof.owner === 'alpha' && proof.group === false, 'native-case-scope');
  const { accepted, cached, render, row, slice } = evidence.witness ?? {};
  ensure(accepted && cached && render && row && slice, 'complete-native-witness');
  ensure(pickWitness({ errors: [], accepted: [accepted], renders: [cached, render], rows: [row], slices: [slice] }, {
    owner: 'alpha', revision: evidence.receipt?.revision, receiptAtNode: evidence.receipt?.receivedAtNode,
    cachedGeneration: cached.generation, responses: evidence.transport ?? [], releasedResponseIds: evidence.releasedResponseIds ?? [],
  }), 'exact-r109-qualified-witness');
  ensure(accepted.renderGeneration === render.generation && render.generation === row.generation && row.generation === slice.generation
    && row.bPresent === true && slice.next <= row.index && slice.next < slice.total && slice.at < row.at, 'real-later-slice');
  ensure(cached.provenance === 'shown-result-cache' && cached.stateRevision === evidence.receipt.revision
    && cached.viewRevision < cached.stateRevision && cached.resultAbsent && cached.busyText && cached.painted
    && cached.promiseStillCurrent && cached.generationStillCurrent && cached.completeAt < render.startedAt, 'cached-fallback-provenance');
  ensure(accepted.renderComplete && accepted.resultStillCurrent && render.painted && render.promiseStillCurrent && render.generationStillCurrent
    && accepted.response.id === render.responseId && accepted.response.rawSHA256 === render.bodySHA256
    && accepted.response.observedSHA256 === render.bodySHA256, 'fresh-body-render-join');
  const commands = proof.commands ?? [], history = proof.history ?? [], a = 'custom:r68-alpha-001', b = 'custom:r68-alpha-071';
  ensure(commands.length === 2 && new Set(commands.map(q => q.requestId)).size === 2
    && commands.every((q, i) => q.command.type === 'set-task-status' && q.command.memberId === 'alpha'
      && q.command.taskId === [a, b][i] && q.command.challengeCompleted === true), 'exact-native-commands');
  ensure(history.length === 2 && history.every(item => item.type === 'set-task-status' && item.command.memberId === 'alpha' && item.command.challengeCompleted === true)
    && history.filter(item => item.command.taskId === a).length === 1
    && history.filter(item => item.command.taskId === b).length === 1 && proof.persistedB?.challengeCompleted === true, 'persisted-owner-history');
  ensure(drain.drained === true && drain.graceful === true && drain.forced === false && drain.error === null
    && drain.exit?.code === 0 && drain.exit.signal === null && drain.close?.code === 0 && drain.close.signal === null
    && drain.stopped?.ok === true && drain.stopped.pid === drain.pid, 'fixture-drain-proof');
  return { passed: true, status: 'correct', nativeAssertionsPassed: true, freshBodyJoinPassed: true, cachedFallbackPassed: true,
    realSlicePassed: true, trustedSpacePassed: true, commandHistoryPassed: true, persistedOwnerReadbackPassed: true,
    fixtureDrainPassed: true, cleanupPassed: true, finalProofSha256: sha(Buffer.from(JSON.stringify(tags))),
    observedBodySha256: accepted.response.rawSHA256, metrics: { focusNamedPassCount: 1, focusCommandCount: 2, focusHistoryCount: 2 } };
}

export function procIdentity(text) {
  const right = text.lastIndexOf(')'), fields = text.slice(right + 2).trim().split(/\s+/);
  ensure(right > 0 && fields.length >= 22, 'proc-stat-format');
  return { pid: Number(text.slice(0, text.indexOf(' '))), state: fields[0], ppid: Number(fields[1]), pgrp: Number(fields[2]), start: fields[19] };
}
export function ancestors(pid = process.pid) {
  const rows = []; let current = pid;
  while (current > 0) {
    ensure(rows.length < 16 && !rows.some(row => row.pid === current), 'ancestor-chain');
    const row = procIdentity(fs.readFileSync(`/proc/${current}/stat`, 'utf8')); ensure(row.pid === current, 'proc-identity'); rows.push(row);
    if (current === 1) break; current = row.ppid;
  }
  ensure(rows.at(-1)?.pid === 1, 'container-ancestor-root'); return rows;
}
export function unexpectedProcesses(allowed) {
  const expected = new Map(allowed.map(row => [row.pid, row.start])), unexpected = [];
  for (const value of fs.readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
    try { const row = procIdentity(fs.readFileSync(`/proc/${value}/stat`, 'utf8'));
      if (expected.get(row.pid) !== row.start) unexpected.push({ pid: row.pid, start: row.start, state: row.state });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return unexpected;
}
export async function waitDrained(allowed, milliseconds = 2000) {
  const until = performance.now() + milliseconds;
  while (unexpectedProcesses(allowed).length) { ensure(performance.now() < until, 'container-descendants-remain'); await new Promise(resolve => setTimeout(resolve, 20)); }
  return true;
}
export function publicResult(value) {
  const booleans = FOCUS_FLAGS;
  const out = { schema: 'r125-focus-functional-v1', mode: 'r125-alpha-personal-controlled-v1', status: value.status === 'correct' ? 'correct' : 'failed',
    sourceCommit: PIN, scope: { owner: 'alpha', group: false }, openGates: ['group-on', 'physical-paint', 'other-inputs', 'r125-other-native-cases', 'r125-slo'] };
  const codes = ['r125-focus-correct', 'r125-admission-failed', 'r125-native-failed', 'r125-drain-failed', 'r125-entry-failed', 'r125-source-changed'];
  out.code = codes.includes(value.code) ? value.code : 'r125-entry-failed';
  for (const name of booleans) out[name] = value[name] === true;
  for (const name of ['finalProofSha256', 'observedBodySha256']) if (/^[a-f0-9]{64}$/.test(value[name] ?? '')) out[name] = value[name];
  const diagnostic = projectDiagnostic(value); Object.assign(out, diagnostic);
  const nativeDiagnostic = projectNativeDiagnostic(value); Object.assign(out, nativeDiagnostic);
  const tabDiagnostic = projectTabDiagnostic(value); Object.assign(out, tabDiagnostic);
  out.metrics = { ...diagnostic.metrics, ...nativeDiagnostic.metrics, ...tabDiagnostic.metrics, ...Object.fromEntries(['focusNamedPassCount', 'focusCommandCount', 'focusHistoryCount'].filter(name => Number.isSafeInteger(value.metrics?.[name]) && value.metrics[name] >= 0 && value.metrics[name] <= 2).map(name => [name, value.metrics[name]])) };
  if (!booleans.every(name => out[name]) || out.status !== 'correct' || out.code !== 'r125-focus-correct'
    || out.metrics.focusNamedPassCount !== 1 || out.metrics.focusCommandCount !== 2 || out.metrics.focusHistoryCount !== 2
    || !/^[a-f0-9]{64}$/.test(out.finalProofSha256 ?? '') || !/^[a-f0-9]{64}$/.test(out.observedBodySha256 ?? '')) { out.passed = false; out.status = 'failed'; }
  return out;
}
export function focusAccepted(final) {
  const value = final?.result?.caseResult, cleanup = final?.containerCleanup, baseline = final?.baseline;
  return final?.envelope === PROTOCOL && final.sourceCommit === PIN && final.control === 'none' && final.mode === 'browser'
    && final.passed === true && final.cleanupPassed === true && cleanup?.removed === true
    && cleanup.running === false && cleanup.pid === 0 && cleanup.exitCode === 0 && cleanup.oomKilled === false
    && baseline?.node === 'v24.19.0' && baseline.playwright === '1.62.1' && baseline.chromium === '151.0.7922.34'
    && baseline.chromiumRevision === '1234' && baseline.image === IMAGE && baseline.platform === 'linux/amd64'
    && value?.schema === 'r125-focus-functional-v1' && value.mode === 'r125-alpha-personal-controlled-v1'
    && value.status === 'correct' && value.code === 'r125-focus-correct' && FOCUS_FLAGS.every(name => value[name] === true)
    && value.scope?.owner === 'alpha' && value.scope.group === false && value.caseExitCode === 0
    && value.metrics?.focusNamedPassCount === 1 && value.metrics.focusCommandCount === 2 && value.metrics.focusHistoryCount === 2
    && /^[a-f0-9]{64}$/.test(value.finalProofSha256 ?? '') && /^[a-f0-9]{64}$/.test(value.observedBodySha256 ?? '');
}
