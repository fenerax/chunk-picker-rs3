import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { requireMemoryProfile, evaluateMemoryProfile } from './memory-profile.mjs';
import { requireResidency, evaluateResidency } from './residency.mjs';
import { evaluate, markdown } from './report.mjs';
import { evaluateSustained, sustainedMarkdown } from './sustained-report.mjs';

export const writeRunManifest = (directory, manifest, options) =>
  writeFile(path.join(directory, 'run-manifest.json'), JSON.stringify(manifest, null, 2), options);

export async function writeRunResults(directory, result) {
  result.memoryProfileVerification = evaluateMemoryProfile(result);
  if (result.memoryProfileVerification.samples.mismatched) requireMemoryProfile(result.memoryProfileVerification);
  if (result.requestedResidency !== undefined) {
    result.residencyVerification = evaluateResidency(result);
    if (result.residencyVerification.samples.mismatched) requireResidency(result.residencyVerification);
  }
  result.gates = result.profile.sustained ? evaluateSustained(result) : evaluate(result);
  await writeFile(path.join(directory, 'results.json'), JSON.stringify(result, null, 2));
  await writeFile(path.join(directory, 'summary.md'), result.profile.sustained ? sustainedMarkdown(result) : markdown(result));
}
