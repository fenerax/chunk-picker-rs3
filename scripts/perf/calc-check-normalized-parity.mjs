// One-off migration check: retain the old normalized-input fingerprint as an
// independent bridge to the source-inventory manifest used by sharded checks.
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { buildCorpus } from '../../tools/calc-check/corpus.mjs';
import { hash } from '../../tools/calc-check/compare.mjs';

export async function normalizedParity(spec, seed, expected, progress) {
  const began = performance.now(), corpus = await buildCorpus(spec, seed);
  try {
    const total = corpus.groups.reduce((n, group) => n + group.states.length, 0);
    let states = 0;
    const groups = [];
    for (const group of corpus.groups) {
      const bundle = hash(JSON.stringify(group.bundle, (_, v) => v instanceof Map ? [...v] : v instanceof Set ? [...v] : v));
      const inputs = [];
      for (let index = 0; index < group.states.length; index++) {
        const entry = group.states[index];
        if (entry.load) await entry.load();
        const fingerprint = { source: entry.source, digest: entry.digest };
        inputs.push(fingerprint);
        // This verifier never replays inputs. Release the loader's compressed
        // snapshot as soon as its fingerprint has been recorded.
        group.states[index] = fingerprint;
        states++;
        if (states % 16 === 0 || states === total) progress?.({ states, total, durationMs: performance.now() - began });
      }
      groups.push({ bundle, states: inputs });
    }
    const actual = hash(JSON.stringify(groups));
    return { states, expectedHash: expected, actualHash: actual, differences: Number(actual !== expected), durationMs: performance.now() - began };
  } finally { await corpus.close(); }
}
async function cli(args) {
  if (args.includes('--help')) {
    console.log('calc-check-normalized-parity --baseline <legacy-report.json> --corpus <spec.json|save> --output </tmp/result.json> [--data-dir <copied-save>]');
    return;
  }
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--baseline','--corpus','--output','--data-dir'].includes(args[i]) || args[i+1] === undefined) throw new TypeError('invalid');
    options[args[i].slice(2)] = args[i+1];
  }
  if (!options.baseline || !options.corpus || !options.output) throw new TypeError('invalid');
  const baseline = JSON.parse(await readFile(options.baseline, 'utf8'));
  if (baseline.corpusManifest || !/^[a-f0-9]{64}$/.test(baseline.corpusManifestHash) || !Number.isSafeInteger(baseline.seed)) throw new TypeError('legacy-baseline-required');
  const spec = options.corpus === 'save' ? { save: { dataDir: options['data-dir'] } } : JSON.parse(await readFile(options.corpus, 'utf8'));
  if (options['data-dir']) spec.save = { ...spec.save, dataDir: options['data-dir'] };
  if (spec.save?.gameDefaultsFile) process.env.RS3_GAME_DEFAULTS_FILE = spec.save.gameDefaultsFile;
  const result = await normalizedParity(spec, baseline.seed, baseline.corpusManifestHash, progress => console.log(JSON.stringify(progress)));
  await writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result));
  if (result.differences) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) cli(process.argv.slice(2)).catch(() => { console.error('verification-failed'); process.exitCode = 1; });
