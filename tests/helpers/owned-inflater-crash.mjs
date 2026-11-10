import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { auditInflater } from './owned-inflater-diagnostics.mjs';
import { FROZEN_RELEASE } from '../../scripts/lib/frozen-runtime.mjs';
const [config, seam, checkout] = process.argv.slice(2);
const { settings, ownedFormat2 } = JSON.parse(await readFile(config));
const audit = auditInflater(path.join(settings.controlDir, 'inflate-owned-format-1/progress.json'));
const { inflateOwnedFormat1 } = await import('../../scripts/linux/inflate-owned-format-1.mjs');
const frozen = { release: FROZEN_RELEASE, ...await import(pathToFileURL(path.join(checkout, 'app/storage/store.mjs'))),
  core: await import(pathToFileURL(path.join(checkout, 'app/core/state.mjs'))) };
await inflateOwnedFormat1({ settings, ownedFormat2, controller: { state: async () => ({ stopped: true }) }, frozen,
  async crash(point) {
    if (point !== seam) return;
    // Flush evidence through IPC, not a timed wait. A nonzero child/worker count
    // makes the parent regression fail instead of silently leaving an orphan.
    await new Promise((resolve, reject) => process.send({ point, audit: audit.snapshot() }, error => error ? reject(error) : resolve()));
    process.exit(72);
  } });
process.exit(73);
