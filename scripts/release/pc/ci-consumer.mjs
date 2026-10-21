// An explicit boundary for the consumer/envelope work described in release-ci.md.
// Legacy stage/practice/prepare/gates-only are deliberately never called here.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { preflight, consumerRelativePath, regularPath } from './ci-inputs.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const requiredHostedGates = ['kit-practice', 'kit-gallery', 'kit-copied-startup', 'kit-install', 'kit-pack-transition', 'kit-text-lane'];
const localChecks = ['paths', 'acl', 'owners', 'save', 'baselineBridge', 'rollback'];
const requireThat = (condition, gate = 'consumer-integration') => { if (!condition) throw new Error(`${gate} refused.`); };

function sameApproval(current, approved) {
  for (const key of ['runId', 'attempt', 'releaseId', 'kitDir', 'workDir', 'candidatePath', 'previous',
    'currentPointerSha256', 'requestSha256', 'expectedSha256', 'evidenceSha256'])
    requireThat(current[key] === approved?.[key], 'changed-inputs');
  requireThat(current.artifact.digest === approved?.artifact?.digest && current.artifact.id === approved?.artifact?.id, 'changed-inputs');
}

export async function consume(action, options, dependencies = {}) {
  requireThat(['stage', 'admit'].includes(action));
  let checked = await preflight(options, { ...dependencies,
    kitState: action === 'stage' ? 'absent' : options.goLive ? 'frozen' : 'staged' });
  sameApproval(checked, options.approved);
  // The current candidate has no such consumer. Refuse before mkdir, source
  // export, locks or any legacy lifecycle command. File presence alone is not
  // a capability: its version and operations are checked after import as well.
  requireThat(checked.consumerAvailable);
  const modulePath = path.join(options.checkout, consumerRelativePath);
  await regularPath(modulePath);
  // Match exact committed bytes immediately before executing the reviewed code.
  const { runReadOnly } = await import('./ci-inputs.mjs');
  const run = dependencies.run || runReadOnly;
  const committed = run('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-C', options.checkout, 'show', `${options.candidateCommit}:${consumerRelativePath}`]);
  requireThat(hash(await readFile(modulePath)) === hash(committed));
  // Consumers must return structured results; native diagnostic output stays
  // private, as it can contain installation paths or save diagnostics.
  const stdout = process.stdout.write, stderr = process.stderr.write;
  process.stdout.write = process.stderr.write = () => true;
  try {
    const consumer = await import(pathToFileURL(modulePath).href);
    requireThat(consumer.contract?.schema === 'rs3-release-ci-pc-consumer-v1'
      && consumer.contract.pcOnly === true && typeof consumer.stageAndBind === 'function'
      && typeof consumer.assertAdmission === 'function');
    const context = () => ({ sourceRepo: options.checkout, candidateCommit: options.candidateCommit,
      kitDir: checked.kitDir, workDir: checked.workDir, candidatePath: checked.candidatePath,
      releaseId: checked.releaseId, current: options.current, request: options.request,
      evidenceDir: options.evidenceDir, node: options.node, ps: options.ps,
      verified: structuredClone(checked), requiredHostedGates: [...requiredHostedGates], localChecks: [...localChecks] });
    if (action === 'stage') {
      // Only export/stage the verified candidate and late-bind the real PC
      // inputs. The consumer must import separate hosted kit-gate evidence;
      // rs3-release-ci-evidence-v1 alone cannot satisfy these six gates.
      await consumer.stageAndBind(context());
      checked = await preflight(options, { ...dependencies, kitState: 'staged' });
      sameApproval(checked, options.approved);
    }
    const admission = await consumer.assertAdmission({ ...context(), phase: options.goLive ? 'go-live' : 'before-freeze' });
    requireThat(admission?.schema === 'rs3-release-ci-pc-admission-v1' && admission.passed === true
      && admission.candidateCommit === options.candidateCommit && admission.releaseId === checked.releaseId
      && admission.currentPointerSha256 === checked.currentPointerSha256
      && admission.evidenceSha256 === checked.evidenceSha256 && admission.artifactDigest === checked.artifact.digest
      && Array.isArray(admission.hostedGates) && admission.hostedGates.length === requiredHostedGates.length
      && new Set(admission.hostedGates.map(row => row.name)).size === requiredHostedGates.length
      && requiredHostedGates.every(name => admission.hostedGates.some(row => row.name === name && row.status === 'pass'))
      && localChecks.every(name => admission.localChecks?.[name] === true), 'admission');
    requireThat(hash(await readFile(options.current)) === checked.currentPointerSha256
      && hash(await readFile(options.request)) === checked.requestSha256
      && hash(await readFile(options.expectedEvidence)) === checked.expectedSha256, 'changed-inputs');
    return checked;
  } finally { process.stdout.write = stdout; process.stderr.write = stderr; }
}
