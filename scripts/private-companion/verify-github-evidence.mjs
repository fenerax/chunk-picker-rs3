#!/usr/bin/env node
import { EvidenceRefusal, validateArguments, verifyHostedEvidence } from './evidence-lib.mjs';

async function main() {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new EvidenceRefusal('node-24-required');
  const args = process.argv.slice(2), options = {};
  const keys = { '--sha': 'sha', '--ref': 'ref', '--run-id': 'runId', '--attempt': 'attempt' };
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Usage: node verify-github-evidence.mjs --sha FULL_SHA [--ref refs/heads/BRANCH] [--run-id ID [--attempt N]]\n'); return;
  }
  for (let index = 0; index < args.length; index += 2) {
    const key = keys[args[index]], value = args[index + 1];
    if (!key || !value || options[key] !== undefined) throw new EvidenceRefusal('invalid-cli-arguments');
    if (key === 'runId' || key === 'attempt') {
      if (!/^[1-9][0-9]*$/.test(value)) throw new EvidenceRefusal('invalid-numeric-argument');
      options[key] = Number(value);
    } else options[key] = value;
  }
  validateArguments(options);
  process.stdout.write(JSON.stringify(await verifyHostedEvidence(options), null, 2) + '\n');
}
main().catch(error => {
  process.stderr.write((error instanceof EvidenceRefusal ? error.message : 'Hosted public evidence refused: internal-validation-error.') + '\n');
  process.exitCode = 1;
});
