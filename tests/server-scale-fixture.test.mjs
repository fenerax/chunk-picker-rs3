import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readOpenF2P, scaleOpenF2P, copiesFor, writeScaledApp } from '../scripts/perf/scale-server.mjs';

test('the scaled F2P fixture is deterministic, connected and keeps identities unique', async () => {
  const batch = await readOpenF2P();
  const scaled = scaleOpenF2P(batch, { copies: 3 });
  assert.equal(JSON.stringify(scaled), JSON.stringify(scaleOpenF2P(batch, { copies: 3 })));
  assert.equal(JSON.stringify(scaleOpenF2P(batch, { copies: 1 }).tasks), JSON.stringify(batch.tasks), 'Copy 0 is the public batch');
  assert.equal(scaled.cells.length, batch.cells.length * 3);
  assert.equal(scaled.tasks.length, batch.tasks.length * 3);
  for (const name of ['cells', 'tasks', 'sources', 'shops', 'stock', 'monsters', 'drops', 'connections']) {
    const ids = scaled[name].map(row => row.id);
    assert.equal(new Set(ids).size, ids.length, `${name} identities are unique`);
  }
  const cells = new Set(scaled.cells.map(row => row.id));
  assert.ok(scaled.cells.every(row => Number(row.id) === row.regionX * 256 + row.regionY), 'Cell keys follow their region coordinates');
  assert.ok(scaled.connections.every(row => cells.has(row.from) && cells.has(row.to)));
  assert.ok(scaled.tasks.every(row => cells.has(row.cell) && (row.requiredCells ?? []).every(cell => cells.has(cell))));
  const labels = scaled.tasks.map(row => `${row.skill}\u0000${row.label}`);
  assert.equal(new Set(labels).size, labels.length, 'Task labels stay unique within each category');
  const shops = scaled.shops.map(row => row.name);
  assert.equal(new Set(shops).size, shops.length);
  const tasks = new Set(scaled.tasks.map(row => row.id));
  assert.ok(scaled.tasks.every(row => (row.prerequisiteTasks ?? []).every(id => tasks.has(id))));
  // Every copy's starting area is reachable from the original's.
  const neighbours = new Map([...cells].map(id => [id, []]));
  for (const row of scaled.connections) { neighbours.get(row.from).push(row.to); neighbours.get(row.to).push(row.from); }
  const start = '12850', seen = new Set([start]), queue = [start];
  for (const id of queue) for (const next of neighbours.get(id)) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  const anchor = batch.cells.findIndex(cell => cell.id === start);
  assert.ok(scaled.cells.filter((row, index) => index % batch.cells.length === anchor).every(row => seen.has(row.id)), 'Synthetic links join the copies');
  const copies = copiesFor(batch, 20 * 1024 ** 2);
  assert.ok(copies > 10 && copies < 30, 'About 20 MiB needs a proportional number of copies');
});

test('a scaled application copy resolves its larger synthetic F2P dataset', { timeout: 120000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'server-scale-fixture-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { appDir, copies, bytes } = await writeScaledApp(directory, { copies: 2 });
  assert.equal(copies, 2);
  const written = await readFile(path.join(appDir, 'datasets', 'open-f2p', 'wiki-derived', 'dataset.json'));
  assert.equal(written.length, bytes);
  const { resolveOpenF2P } = await import(pathToFileURL(path.join(appDir, 'open-f2p.mjs')).href);
  const provider = resolveOpenF2P();
  const definitions = provider.json('app/datasets/open-f2p/definitions.json');
  const batch = await readOpenF2P();
  assert.equal(Object.keys(definitions.chunks).length, batch.cells.length * 2);
  assert.match(provider.status().version, /-synthetic-x2$/);
});
