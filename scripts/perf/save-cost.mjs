// One serial sample per cell, synthetic data only; never opens an existing save.
// node --import ./scripts/perf/save-cost/trace.mjs scripts/perf/save-cost.mjs --out var/save-cost-before
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { parseArgs } from 'node:util';
import { setPriority, constants } from 'node:os';
import { createTestSelection } from '../test-classification.mjs';

if (typeof globalThis.__saveCostScope !== 'function') throw Error('Preload scripts/perf/save-cost/trace.mjs');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major !== 24 || minor < 20) throw Error('Use Node 24.20+ within 24.x');
setPriority(constants.priority.PRIORITY_BELOW_NORMAL);
const policy = createTestSelection(new Map([['probe.test.mjs', '// @test dataset=open-f2p']]));
for (const [key, value] of Object.entries(policy.testRunPolicy('probe.test.mjs').env)) {
  if (value === undefined) delete process.env[key]; else process.env[key] = value;
}
const { values } = parseArgs({ options: { out: { type: 'string' }, delta: { type: 'boolean', default: false } } });
if (!values.out) throw Error('--out must name a new output directory');
const output = path.resolve(values.out);
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'started.json'), JSON.stringify({ node: process.version, at: new Date().toISOString() }), { flag: 'wx' });
const [{ selectedDataset }, { createRuleRegistry }, { createGroupState, applyValidatedCommand }, { openStore },
  { makeCatalogue, pickerId, clock }, { createOwnedBaseManifest }, { createOwnedStorage }, { ownedCodec }] = await Promise.all([
  import('../../app/dataset-runtime.mjs'), import('../../app/core/rules.mjs'), import('../../app/core/state.mjs'),
  import('../../app/storage/store.mjs'), import('./owned-acceptance/fixture.mjs'),
  import('../../app/storage/owned-base-schema.mjs'), import('../../app/storage/owned-storage.mjs'), import('../../app/storage/owned-codec.mjs'),
]);
const shape = { tasks: 24000, aliases: 100000, members: 4, chunks: 256, archiveSegments: 2, archiveEvents: 100 };
const registry = createRuleRegistry();
const data = makeCatalogue(shape, { id: selectedDataset.datasetId, contractVersion: selectedDataset.datasetContractVersion, digest: selectedDataset.digest });
const chunks = [...data.world.chunks.keys()];
const manifest = createOwnedBaseManifest([data.pin]), catalogueRoot = path.join(output, 'catalogue');
const ownedOptions = { pickerId: pickerId(0), catalogueRoot, dataset: data.pin.dataset, manifest, releaseBytes: data.bytes };
await mkdir(path.join(output, 'publisher'), { recursive: true });
const publisher = createOwnedStorage(ownedOptions, path.join(output, 'publisher'));
await publisher.withLease(() => publisher.ensurePublished());
// Build valid guarded inverses on the small catalogue, then attach the acceptance
// catalogue exactly as the acceptance fixture does. No measured setup work.
let template = createGroupState(Array.from({ length: 4 }, (_, i) => ({ id: `member-${i}`, name: `Synthetic member ${i}`, unlocked: [chunks[0]] })), registry);
const phases = ['load', 'apply', 'validate', 'encode', 'publish', 'reply'];
const records = [];
for (const history of [4, 200, 1000, 5000]) {
  while (template.revision < history + 200) template = applyValidatedCommand(template, {
    type: 'set-note', memberId: `member-${template.revision % 4}`, chunkId: chunks[template.revision % chunks.length],
    note: `Synthetic history ${template.revision}`,
  }, { registry, world: data.world, now: clock() });
  for (const format of [1, 2]) {
    const directory = path.join(output, `format${format}-history${history}`);
    await mkdir(path.join(directory, 'history'), { recursive: true });
    const state = structuredClone(template), references = [];
    state.tasks = [...data.base.tasks];
    state.tasks[0] = { ...state.tasks[0], memberIds: ['member-0'] };
    state.tasks.push({ id: 'custom:save-cost', label: 'Synthetic custom task', category: 'Custom', memberIds: ['member-1'] });
    state.identityRegistry = structuredClone(data.base.identityRegistry);
    state.members.forEach((member, i) => { member.completedTasks = [data.base.tasks[i + 1].id]; });
    for (let segment = 0; segment < 2; segment++) {
      const events = state.history.slice(segment * 100, (segment + 1) * 100);
      const id = `history-${String(events[0].revision).padStart(16, '0')}-${String(events.at(-1).revision).padStart(16, '0')}-${String(segment).padStart(16, '0')}.json.gz`;
      await writeFile(path.join(directory, 'history', id), gzipSync(JSON.stringify({ format: 'rs3-chunk-picker-history', events })));
      references.push({ id });
    }
    state.history = state.history.slice(200);
    state.provenance = { historyArchive: references };
    await writeFile(path.join(directory, 'state.json'), JSON.stringify({ format: 'rs3-chunk-picker', schemaVersion: 1,
      ...(format === 2 ? ownedCodec(data.base, data.pin).encode(state) : { state }) }) + '\n');
    const store = await openStore({ dataDir: directory, world: data.world, registry, now: clock, completionCodec: false,
      retention: { historyEntries: history, backupDays: 90 }, ownedFormat2: format === 2 ? ownedOptions : false,
      ...(values.delta ? { deltaValidation: true } : {}) });
    try {
      const commands = {
        tick: { type: 'tick-active-tasks', memberId: 'member-0', taskIds: [data.base.tasks[0].id] },
        note: { type: 'set-note', memberId: 'member-1', chunkId: chunks[1], note: 'Synthetic measured note' },
        undo: { type: 'undo' },
      };
      for (const [kind, command] of Object.entries(commands)) {
        const cpu = () => { const used = process.cpuUsage(); return used.user + used.system; };
        const costs = Object.fromEntries(phases.map(phase => [phase, 0]));
        let last = cpu(); const start = last;
        const observer = { current: 'load', phase(phase) {
          const current = cpu(); costs[this.current] += (current - last) / 1000; last = current; this.current = phase;
        } };
        globalThis.__saveCostObserver = observer;
        const reply = await store.commandSerialized(command, store.getInfo().revision, { view: 'play-v1' });
        observer.phase('reply');
        delete globalThis.__saveCostObserver;
        records.push({ format, history, kind, deltaValidation: values.delta, ...costs, total: (last - start) / 1000, revision: reply.revision });
      }
    } finally { delete globalThis.__saveCostObserver; await store.close(); }
  }
}
await writeFile(path.join(output, 'results.json'), JSON.stringify({ node: process.version, dataset: selectedDataset.datasetId, shape, records }, null, 2));
const table = ['| Format | Live History | Command | Load/archive validation | Apply | Validate | Encode | Publish | Reply | Total |',
  '| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...records.map(row => `| ${row.format} | ${row.history} | ${row.kind} | ${[...phases, 'total'].map(key => row[key].toFixed(1)).join(' | ')} |`) ].join('\n');
await writeFile(path.join(output, 'table.md'), table + '\n');
console.log(table);
