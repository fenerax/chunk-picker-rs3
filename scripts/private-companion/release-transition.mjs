// The handover decisions are independent of PowerShell, files and processes.
// The native adapter owns each atomic operation and returns observed hashes.
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function assertPair(pair, inverse = false) {
  const { binding, pointer, sourceBinding, targetBinding, sourcePointer, targetPointer } = pair;
  if (![sourceBinding, targetBinding].includes(binding) || ![sourcePointer, targetPointer].includes(pointer)) throw Error('Unknown binding/pointer pair; recovery paused.');
  if (pointer === targetPointer && binding !== targetBinding && !inverse) throw Error('Impossible binding/pointer pair; recovery paused.');
}
export async function runManagedTransition(stage, { packUpgrade, recover, reversePending, rollback }) {
  try {
    for (const name of ['ownership', 'pause', 'identity-before-stop', 'owned-stop', 'verify-install', 'references-after-stop', 'identity-after-stop']) await stage(name);
    let pair = await stage('observe-pair');
    if (packUpgrade) {
      await stage('pack-check');
      pair = await stage('observe-pair');
      if (!recover) {
        if (reversePending) {
          assertPair(pair, true);
          if (pair.pointer === pair.sourcePointer && pair.binding !== pair.sourceBinding) throw Error('Unknown interrupted forward pair; rollback paused.');
        }
        else if (pair.binding !== pair.sourceBinding) throw Error('Binding changed before journal.');
        await stage('journal-intent');
      }
      pair = await stage('validate-pair');
      assertPair(pair, !!(rollback && pair.allowInversePartial));
      if (pair.binding !== pair.targetBinding) await stage('binding-commit');
      await stage('binding-journal');
    }
    if (pair.pointer !== pair.targetPointer) await stage('pointer-commit');
    if (packUpgrade) await stage('pointer-journal');
    await stage('identity-before-start');
    if (packUpgrade) await stage('starting-journal');
    await stage('candidate-start-readiness');
    await stage('post-start-validation');
    await stage('rollback-readiness');
    await stage('unpause');
  } catch (error) {
    // The native stage owns pre-commit restoration and retains diagnostics.
    // A hard process exit never executes this path.
    try { await stage('refusal-restoration'); }
    catch (restoration) { restoration.cause = error; throw restoration; }
    throw error;
  }
}

if (process.argv[2] === 'drive' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const lines = createInterface({ input: process.stdin, terminal: false });
  const iterator = lines[Symbol.asyncIterator](); let id = 0;
  const send = value => process.stdout.write(JSON.stringify(value) + '\n');
  const stage = async name => {
    send({ id: ++id, stage: name });
    const response = await iterator.next();
    if (response.done) throw Error('Native stage owner disappeared.');
    const result = JSON.parse(response.value);
    if (result.id !== id) throw Error('Native stage acknowledgement differs.');
    if (!result.ok) throw Error(result.error);
    return result.value;
  };
  try { await runManagedTransition(stage, JSON.parse(Buffer.from(process.argv[3], 'base64'))); send({ complete: true, ok: true }); }
  catch (error) { send({ complete: true, ok: false, error: error.message }); process.exitCode = 1; }
  finally { lines.close(); process.stdin.destroy(); }
}
