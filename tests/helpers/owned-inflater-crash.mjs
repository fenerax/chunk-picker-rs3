import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { inflateOwnedFormat1 } from '../../scripts/linux/inflate-owned-format-1.mjs';
import { FROZEN_RELEASE } from '../../scripts/lib/frozen-runtime.mjs';
const [config, seam, checkout] = process.argv.slice(2);
const { settings, ownedFormat2 } = JSON.parse(await readFile(config));
const frozen = { release: FROZEN_RELEASE, ...await import(pathToFileURL(path.join(checkout, 'app/storage/store.mjs'))) };
await inflateOwnedFormat1({ settings, ownedFormat2, controller: { state: async () => ({ stopped: true }) }, frozen,
  crash(point) { if (point === seam) process.exit(72); } });
process.exit(73);
