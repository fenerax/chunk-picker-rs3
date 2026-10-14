import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, mkdtemp, writeFile, copyFile, rm, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Select before any app import. No server, storage, browser or private values.
process.env.RS3_DATASET = 'open-f2p';
const root = fileURLToPath(new URL('../', import.meta.url));
const folder = path.join(root, 'app/datasets/open-f2p');
const authored = path.join(folder, 'authored/batch.json');
const datasetPath = path.join(folder, 'wiki-derived/dataset.json');
const spec = JSON.parse(await readFile(authored, 'utf8'));
const batchBytes = await readFile(datasetPath);
const batch = JSON.parse(batchBytes);
const baseline = JSON.parse(await readFile(path.join(folder, 'wiki-derived/baseline-0.1.0.json'), 'utf8'));
const baseline4 = JSON.parse(await readFile(path.join(folder, 'wiki-derived/baseline-0.4.0.json'), 'utf8'));
const baseline3 = JSON.parse(await readFile(path.join(folder, 'wiki-derived/baseline-0.3.0.json'), 'utf8'));
const baseline2 = JSON.parse(await readFile(path.join(folder, 'wiki-derived/baseline-0.2.0.json'), 'utf8'));
const { selectedDataset: dataset } = await import('../app/dataset-runtime.mjs');
const { authoredIdentityRegistry, resolveTaskAlias, permanentTaskId, isPermanentId } = await import('../app/tasks/identity.mjs');
const { chunkId, templates } = await import('../scripts/build-open-f2p.mjs');
const { buildServices } = await import('../scripts/lib/open-f2p-services.mjs');
const { buildWalking } = await import('../scripts/lib/open-f2p-walking.mjs');
const { templateFields, questPrerequisites, buildStories } = await import('../scripts/lib/open-f2p-stories.mjs');
const { createGroupState, validateState } = await import('../app/core/state.mjs');
const { createRuleRegistry } = await import('../app/core/rules.mjs');
const { personalCustomTaskRows } = await import('../app/web/custom-tasks-model.mjs');
const { buildWorld, surfaceCoordinates } = await import('../app/data/world.mjs');
const { createTaskEngine } = await import('../app/tasks/engine.mjs');
const { loadDatasetInputs } = await import('../app/dataset-bootstrap.mjs');
const { resolveDataset } = await import('../app/datasets.mjs');
const { datasetBrowserPayload } = await import('../app/dataset-catalogues.mjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const cacheFilename = title => `${title.replaceAll(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()}-${sha(title).slice(0, 10)}.json`;
const guard = pathToFileURL(path.join(root, 'scripts/lib/open-f2p-build-guard.mjs')).href;

test('batch 1 cell, source, activity and walking identities retain their original meanings', () => {
  assert.equal(baseline.version, '0.1.0');
  assert.deepEqual(Object.fromEntries(['cells', 'sources', 'tasks', 'connections'].map(kind => [kind, baseline[kind].length])),
    { cells: 47, sources: 92, tasks: 92, connections: 5 });
  for (const kind of ['cells', 'sources', 'tasks', 'connections']) {
    const current = new Map(batch[kind].map(row => [row.id, row]));
    for (const original of baseline[kind]) {
      const row = current.get(original.id);
      assert.ok(row, `Lost batch 1 ${kind} identity: ${original.id}`);
      for (const [key, value] of Object.entries(original)) {
        // New supply wording is allowed; the action, resource, cell, level and
        // stable display alias are covered by the remaining original fields.
        if (kind === 'tasks' && key === 'reason') continue;
        if (['provenance', 'coordinates', 'places'].includes(key)) {
          for (const retained of value) assert.ok(row[key].some(entry => JSON.stringify(entry) === JSON.stringify(retained)),
            `Lost batch 1 ${original.id}.${key}: ${JSON.stringify(retained)}`);
        } else assert.deepEqual(row[key], value, `Changed batch 1 ${original.id}.${key}`);
      }
    }
  }
});

test('batch 2 gathering, facilities and walking identities retain their reviewed meanings', () => {
  assert.equal(baseline2.version, '0.2.0');
  const counts = { cells: 48, sources: 92, tasks: 129, connections: 23, shops: 13, stock: 126, services: 17, routes: 1 };
  for (const [kind, count] of Object.entries(counts)) {
    assert.equal(baseline2[kind].length, count);
    const current = new Map(batch[kind].map(row => [row.id, row]));
    for (const original of baseline2[kind]) {
      const row = current.get(original.id);
      assert.ok(row, `Lost batch 2 ${kind} identity: ${original.id}`);
      for (const [key, value] of Object.entries(original)) {
        if (kind === 'cells' && key === 'provenance') {
          for (const receipt of value) assert.ok(row.provenance.some(entry => JSON.stringify(entry) === JSON.stringify(receipt)),
            `Lost batch 2 cell provenance: ${original.id}`);
        } else assert.deepEqual(row[key], value, `Changed batch 2 ${original.id}.${key}`);
      }
    }
  }
});

test('batch 3 rows retain every identity, label, requirement and meaning byte for byte', () => {
  assert.equal(baseline3.version, '0.3.0');
  for (const kind of ['cells', 'sources', 'tasks', 'connections', 'shops', 'stock', 'services', 'routes']) {
    const current = new Map(batch[kind].map(row => [row.id, row]));
    for (const row of baseline3[kind]) assert.deepEqual(current.get(row.id), row, `Changed batch 3 ${kind}: ${row.id}`);
  }
});

test('batch 4 rows retain every identity, label, prerequisite and source meaning byte for byte', () => {
  assert.equal(baseline4.version, '0.4.0');
  for (const kind of ['cells', 'sources', 'tasks', 'connections', 'shops', 'stock', 'services', 'routes', 'quests', 'achievements', 'achievementReview']) {
    const current = new Map(batch[kind].map(row => [row.id ?? row.page, row]));
    for (const row of baseline4[kind]) assert.deepEqual(current.get(row.id ?? row.page), row, `Changed batch 4 ${kind}: ${row.id}`);
  }
});

test('all current F2P quests, including seasonal quests, have resolved completion prerequisites and honest locations', () => {
  assert.equal(batch.quests.length, 53);
  assert.equal(batch.quests.filter(row => row.seasonal).length, 8);
  assert.equal(batch.achievements.length, 15);
  assert.equal(batch.achievementReview.length, 5);
  const cells = new Set(batch.cells.map(row => row.id)), tasks = new Map(batch.tasks.map(row => [row.id, row]));
  const stories = [...batch.quests, ...batch.achievements];
  for (const row of stories) {
    const task = batch.tasks.find(task => task.sourceId === row.id);
    assert.ok(task);
    assert.ok(cells.has(row.cell));
    assert.ok(row.requiredCells.every(cell => cells.has(cell)));
    assert.ok(row.locations.every(location => location.provenance.length && (!location.cell || cells.has(location.cell))));
    if (row.locations.some(location => !location.cell)) assert.ok(row.manualChecks.some(text => /not fully reviewed/.test(text)));
    if (row.start) {
      assert.ok(row.start.cell === null || cells.has(row.start.cell));
      if (row.start.sourceCell) assert.equal(row.start.sourceCell, chunkId(row.start.x, row.start.y));
    }
    if (row.seasonal) assert.ok(row.manualChecks.some(text => /seasonal event is currently available/.test(text)));
    assert.ok(row.prerequisiteTasks.every(id => tasks.get(id)?.skill === 'Quest'));
  }
  assert.equal(new Set(stories.map(row => row.id)).size, stories.length);
  const quest = name => batch.quests.find(row => row.page === name);
  assert.deepEqual(quest("Chef's Assistant").prerequisiteTasks, [tasks.get('rs3:open-f2p:activity:quest:cook-s-assistant').id]);
  assert.deepEqual(quest('Violet is Blue Too').questRequirements, ['Violet is Blue']);
  assert.deepEqual(quest('Hearts of Sanguine').questRequirements, ['Visions of Havenhythe']);
  assert.deepEqual(quest('All Souls\' Eve').questRequirements, ['Necromancy!', 'Field of Screams']);
});

test('quest and achievement gates reach the engine without inventing training or item supplies', () => {
  const definitions = dataset.json('app/datasets/open-f2p/definitions.json');
  const state = createGroupState(dataset.gameDefaults.members);
  state.members[0].unlocked = batch.cells.map(row => row.id);
  const engine = createTaskEngine(definitions, { dataset });
  const result = engine.evaluate(state, state.members[0].id);
  for (const source of [...batch.quests, ...batch.achievements]) {
    const task = batch.tasks.find(row => row.sourceId === source.id), record = definitions.challenges[task.skill][task.label];
    assert.deepEqual(record.Chunks, source.requiredCells);
    assert.deepEqual(record.Skills ?? {}, source.skillRequirements);
    assert.deepEqual(record.CompletedTasks ?? [], source.prerequisiteTasks);
    assert.deepEqual(record.Items ?? [], source.itemRequirements);
    assert.deepEqual(record.ManualChecks ?? [], source.manualChecks);
    assert.notEqual(result.tasks.find(row => row.id === task.id).status, 'unsupported', task.id);
  }
  const byPage = name => batch.quests.find(row => row.page === name);
  assert.equal(byPage('Dragon Slayer').questPointsNeeded, 33);
  assert.equal(byPage('Gower Quest').questPointsNeeded, 34);
  assert.deepEqual(byPage('Visions of Havenhythe').skillRequirements, {}, 'Recommended Crafting 12 is not mandatory');
  assert.deepEqual(byPage('Dragon Slayer').skillRequirements, {}, 'Optional Telekinetic Grab and self-made supplies are not mandatory');
  assert.deepEqual(byPage('Beneath Cursed Tides').skillRequirements, Object.fromEntries(['Attack', 'Cooking', 'Firemaking', 'Magic', 'Mining', 'Smithing', 'Strength', 'Woodcutting'].map(skill => [skill, 30])));
  assert.equal(result.training.Cooking.primary, false, 'No reviewed cooking training source was added');
  const chef = batch.tasks.find(row => row.sourceId === byPage("Chef's Assistant").id);
  assert.ok(result.tasks.find(row => row.id === chef.id).blockers.some(row => row.kind === 'personal-completion'));
  state.taskRules = { Quests: false, Achievement: false };
  const hidden = engine.evaluate(state, state.members[0].id);
  assert.ok(hidden.tasks.filter(row => ['Quest', 'Diary'].includes(row.category)).every(row => row.hidden));
});

test('story selection rejects stale evidence, unresolved quest references and unexpected Lua syntax', () => {
  const provenance = page => ({ page, revision: 1, url: `https://runescape.wiki/w/${page}?oldid=1` });
  const entries = { 'Template:F2P Quests': '{{QuestIcon|Example}}\n|gtitle5 = Historical',
    'Module:Questreq/data': '["Example"] = {},', Example: '{{Quest details|members=No}} Free field' };
  const pages = new Map(Object.entries(entries).map(([page, text]) => [page, { text, provenance: provenance(page) }]));
  const selection = { slug: 'example', page: 'Example', label: 'Finish an example', questPoints: 1,
    evidence: [{ page: 'Example', needle: 'Free field' }], locations: [{ name: 'Field', page: 'Example', needle: 'Free field', cell: null }] };
  const run = row => buildStories({ spec: { questActivities: [row] }, pages, cells: new Map([['12850', {}]]), templates });
  assert.ok(run(selection).quests[0].manualChecks.length);
  assert.throws(() => run({ ...selection, evidence: [{ page: 'Example', needle: 'Changed field' }] }), /evidence changed/);
  assert.throws(() => run({ ...selection, questRequirements: ['Unknown'] }), /prerequisites differ/);
  pages.set('Module:Questreq/data', { text: '["Example"] = {"Unknown"},', provenance: provenance('Module:Questreq/data') });
  assert.throws(() => run({ ...selection, questRequirements: ['Unknown'] }), /Unresolved quest requirement/);
  assert.throws(() => questPrerequisites('["Example"] = run_code(),', 'Example'), /Unsupported/);
  assert.deepEqual(templateFields('{{Example|start=[[A|B]]|requirements={{Skillreq|Mining|10}}|members=No}}'),
    { start: '[[A|B]]', requirements: '{{Skillreq|Mining|10}}', members: 'No' });
});

async function scratch(t) {
  const base = path.join(root, '.local/open-f2p-tests');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'run-'));
  t.after(async () => {
    assert.ok(path.resolve(directory).startsWith(path.resolve(base) + path.sep));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}
async function guardedBuild({ generator, authoredFile, pins, cacheDir, outputDir, probes = false }) {
  const output = path.join(outputDir, 'dataset.json');
  const reads = [authoredFile, ...pins.map(pin => path.join(cacheDir, cacheFilename(pin.requestedTitle)))];
  const source = `import { readFile, readdir, open } from 'node:fs/promises';
    import { readFileSync, createReadStream } from 'node:fs';
    const {buildOpenF2P}=await import(${JSON.stringify(pathToFileURL(generator).href)});
    const {bytes,dataset}=await buildOpenF2P(${JSON.stringify({ cacheDir, outputDir })});
    const denied=[];
    if (${probes}) {
      const targets=${JSON.stringify(['reference/original-picker/tasksMap.json', 'rs3-chunkpicker-chunkinfo-export.json', 'app/data/private-test.json', '.local/duo/state.json', 'archive/forbidden.json', 'maps/original-a.json', 'maps/original-b.json', 'app/datasets/open-f2p/wiki-derived/baseline-0.2.0.json'].map(name => path.join(root, name)))};
      for (const target of targets) for (const fn of [readFile, readFileSync, open, createReadStream]) {
        try { await fn(target); throw new Error('Forbidden data read was allowed'); }
        catch(error) { if(error.code!=='OPEN_F2P_BUILD_FORBIDDEN') throw error; denied.push(target); }
      }
      try { await readdir(${JSON.stringify(folder)}); throw new Error('Dataset discovery allowed'); }
      catch(error) { if(error.code!=='OPEN_F2P_BUILD_FORBIDDEN') throw error; denied.push('directory-scan'); }
    }
    process.stdout.write(JSON.stringify({bytes,dataset,denied,audit:globalThis[Symbol.for('open-f2p-build-audit')]}));`;
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', guard, '--input-type=module', '--eval', source], {
      cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_OPTIONS: '', OPEN_F2P_BUILD_POLICY: JSON.stringify({ reads,
        modules: [generator, ...['open-f2p-receipt.mjs', 'open-f2p-services.mjs', 'open-f2p-walking.mjs', 'open-f2p-stories.mjs', 'open-f2p-equipment.mjs'].map(name => path.join(path.dirname(generator), 'lib', name))], output }) },
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', bytes => { stdout += bytes; });
    child.stderr.on('data', bytes => { stderr += bytes; });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Guarded build timed out')); }, 20000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr)); });
  });
  const actualDataReads = result.audit.filter(row => row.allowed && row.kind === 'read' && !row.path.endsWith('.mjs'));
  const normalize = filename => process.platform === 'win32' ? path.resolve(filename).toLowerCase() : path.resolve(filename);
  assert.deepEqual(actualDataReads.map(row => row.path).sort(), reads.map(normalize).sort(), 'Every pinned input read is recorded, with no extra data');
  assert.ok(result.audit.filter(row => row.allowed && row.kind !== 'read').every(row => row.path === normalize(output) || row.path === normalize(outputDir)));
  assert.equal(result.audit.filter(row => !row.allowed).length, probes ? 33 : 0);
  return result;
}

test('every fact has a real region cell and pinned Wiki page/revision provenance', () => {
  assert.equal(batch.id, 'open-f2p');
  assert.equal(batch.version, '0.5.0');
  const cells = new Map(batch.cells.map(row => [row.id, row]));
  const sources = new Map(batch.sources.map(row => [row.id, row]));
  assert.equal(cells.size, batch.cells.length);
  const pins = new Map(spec.pages.map(pin => [pin.title, pin.revision]));
  for (const row of [...batch.cells, ...batch.connections, ...batch.sources, ...batch.tasks,
    ...(batch.shops ?? []), ...(batch.stock ?? []), ...(batch.services ?? []), ...(batch.routes ?? []), ...(batch.quests ?? []), ...(batch.achievements ?? []), ...(batch.achievementReview ?? []), ...batch.equipment, ...batch.monsters, ...batch.drops, ...batch.facilities, ...batch.recipes, ...batch.equipmentReview, ...batch.acquisitions, batch.coordinateDerivation]) {
    assert.ok(row.provenance.length > 0);
    for (const receipt of row.provenance) {
      assert.equal(receipt.revision, pins.get(receipt.page));
      assert.ok(Number.isSafeInteger(receipt.revision) && receipt.revision > 0);
      const url = new URL(receipt.url);
      assert.equal(url.origin, 'https://runescape.wiki');
      assert.equal(decodeURIComponent(url.pathname.slice(3)).replaceAll('_', ' '), receipt.page);
      assert.equal(url.searchParams.get('oldid'), String(receipt.revision));
    }
  }
  for (const cell of batch.cells) {
    assert.equal(cell.id, String(cell.regionX * 256 + cell.regionY));
    assert.equal(cell.membership, 'free');
  }
  for (const source of batch.sources) {
    assert.ok(cells.has(source.cell));
    assert.equal(source.membership, 'free');
    assert.ok(source.coordinates.length);
    for (const point of source.coordinates) assert.equal(chunkId(point.x, point.y), source.cell);
  }
  const taskSources = new Map([...batch.sources, ...(batch.services ?? []), ...(batch.stock ?? []), ...(batch.routes ?? []), ...(batch.quests ?? []), ...(batch.achievements ?? []), ...batch.drops, ...batch.recipes, ...batch.acquisitions, ...batch.equipment].map(row => [row.id, row]));
  for (const task of batch.tasks) {
    assert.ok(cells.has(task.cell));
    const source = taskSources.get(task.sourceId);
    assert.ok(source, `Unknown task source: ${task.sourceId}`);
    if (source.mode === 'boat') assert.ok([source.from, source.to].includes(task.cell));
    else assert.equal(source.cell, task.cell);
    assert.equal(source.level ?? 1, task.level);
    for (const receipt of source.provenance) assert.ok(task.provenance.some(row => JSON.stringify(row) === JSON.stringify(receipt)),
      `Activity lost source provenance: ${task.id}`);
  }
  const shops = new Map((batch.shops ?? []).map(row => [row.id, row]));
  for (const row of [...(batch.shops ?? []), ...(batch.services ?? [])]) {
    assert.ok(cells.has(row.cell));
    assert.equal(row.membership, 'free');
    assert.ok(row.coordinates.length);
    for (const point of row.coordinates) assert.equal(chunkId(point.x, point.y), row.cell);
  }
  for (const row of batch.stock ?? []) {
    assert.equal(shops.get(row.shopId)?.cell, row.cell);
    assert.equal(row.membership, 'free');
    assert.ok(typeof row.item === 'string' && row.item.length);
    assert.ok(Number.isFinite(row.stock) && row.stock > 0);
    assert.ok(Number.isFinite(row.price) && row.price >= 0);
  }
  for (const row of batch.routes ?? []) {
    assert.ok(cells.has(row.from)); assert.ok(cells.has(row.to));
  }
  for (const edge of batch.connections) { assert.ok(cells.has(edge.from)); assert.ok(cells.has(edge.to)); }
  for (const name of ['cells', 'sources', 'tasks', 'connections', 'shops', 'stock', 'routes', 'equipment', 'monsters', 'drops', 'facilities', 'recipes', 'equipmentReview', 'acquisitions']) assert.equal(batch.coverage[name], batch[name].length);
  assert.equal(batch.coverage.banks, batch.services.filter(row => row.kind === 'bank').length);
  assert.equal(batch.coverage.depositBoxes, batch.services.filter(row => row.kind === 'deposit-box').length);
  assert.match(batch.coordinateDerivation.description, /Project-authored arithmetic/);
  assert.match(batch.coordinateDerivation.description, /no Wiki statement of the numeric ID formula was found/);
});

test('provider activities, sources, connections and aliases retain their own stable namespace', () => {
  assert.equal(dataset.identityNamespace, 'rs3:open-f2p');
  assert.equal(dataset.id, batch.id);
  const registry = authoredIdentityRegistry();
  const rows = [...batch.sources, ...batch.tasks, ...batch.connections, ...batch.shops, ...batch.stock, ...batch.services, ...batch.routes, ...batch.quests, ...batch.achievements, ...batch.equipment, ...batch.monsters, ...batch.drops, ...batch.facilities, ...batch.recipes, ...batch.equipmentReview, ...batch.acquisitions];
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  for (const row of rows) { assert.ok(row.id.startsWith('rs3:open-f2p:')); assert.ok(!row.id.startsWith('rs3:task:')); }
  for (const source of batch.sources) assert.equal(source.id, `rs3:open-f2p:source:${source.slug}:${source.cell}`);
  for (const task of batch.tasks) {
    const source = batch.sources.find(row => row.id === task.sourceId);
    if (source) assert.equal(task.id, `rs3:open-f2p:activity:${source.slug}:${task.cell}`);
    assert.equal(registry.entries[task.id].category, task.skill);
    assert.equal(resolveTaskAlias(task.label, { category: task.skill }).id, task.id);
    assert.equal(permanentTaskId(task.skill, 'A future display rename', { PickerId: task.id }), task.id);
    assert.ok(isPermanentId(task.id));
  }
  const taskMap = dataset.json('app/datasets/open-f2p/task-map.json');
  assert.equal(Object.keys(taskMap).length, batch.tasks.length);
  assert.deepEqual(new Set(Object.values(taskMap)), new Set(batch.tasks.map(row => row.id)));
  for (const key of ['reference/original-picker/tasksMap.json', 'rs3-chunkpicker-chunkinfo-export.json', 'app/data/private-test.json']) {
    assert.throws(() => dataset.bytes(key), /unavailable/);
    assert.throws(() => dataset.json(key), /unavailable/);
  }
});

test('equipment acquisition identities resolve to exact reviewed shop, recipe or encounter rows', () => {
  const cells = new Set(batch.cells.map(row => row.id));
  const sourceKinds = { shop: batch.stock, drop: batch.drops, recipe: batch.recipes };
  assert.ok(batch.equipment.length && batch.monsters.length && batch.drops.length && batch.recipes.length);
  for (const acquisition of batch.acquisitions) {
    const source = sourceKinds[acquisition.sourceKind]?.find(row => row.id === acquisition.sourceId);
    assert.ok(source, `Unresolved acquisition source: ${acquisition.id}`);
    assert.equal(acquisition.item, source.item);
    assert.equal(acquisition.cell, source.cell);
    assert.ok(cells.has(acquisition.cell));
    const task = batch.tasks.find(row => row.sourceId === acquisition.id);
    assert.ok(task, `Missing obtain activity: ${acquisition.id}`);
    assert.equal(task.acquisitionSourceId, source.id);
  }
  for (const item of batch.equipment) {
    assert.equal(item.membership, 'free');
    assert.ok(item.acquisitionSourceIds.length);
    for (const id of item.acquisitionSourceIds) assert.equal(batch.acquisitions.find(row => row.id === id)?.item, item.item);
    const wield = batch.tasks.find(row => row.sourceId === item.id);
    assert.ok(wield?.supplyItems.includes(item.item));
    assert.deepEqual(wield.skillRequirements, item.requirements);
  }
  const materialSources = new Map([...batch.sources, ...batch.acquisitions].map(row => [row.id, row]));
  for (const recipe of batch.recipes) for (const input of recipe.inputs) {
    assert.ok(recipe.inputSourceIds[input.item]?.length, `No reviewed material source: ${recipe.id}:${input.item}`);
    for (const id of recipe.inputSourceIds[input.item]) {
      const source = materialSources.get(id);
      assert.ok(source, `Unresolved material source: ${id}`);
      assert.equal(source.output ?? source.item, input.item);
    }
  }
  assert.deepEqual(batch.equipment.find(row => row.item === 'Bronze hatchet').useRequirements, { Woodcutting: 1 });
  assert.deepEqual(batch.equipment.find(row => row.item === 'Bronze pickaxe').useRequirements, { Mining: 1 });
  for (const row of [...batch.monsters, ...batch.facilities]) {
    assert.ok(cells.has(row.cell));
    assert.equal(row.membership, 'free');
    assert.ok(row.coordinates.length);
    for (const point of row.coordinates) assert.equal(chunkId(point.x, point.y), row.cell);
  }
});

test('equipment activities use ordinary item supplies, exact drops and gated recipe outputs', () => {
  const definitions = dataset.json('app/datasets/open-f2p/definitions.json');
  const state = createGroupState(dataset.gameDefaults.members);
  state.members[0].unlocked = batch.cells.map(row => row.id);
  const evaluate = data => createTaskEngine(data, { dataset }).evaluate(state, state.members[0].id);
  const result = evaluate(definitions);
  const monsterName = row => `${row.name} (${row.variant}; ${row.cell})`;
  const newTasks = batch.tasks.filter(row => !baseline4.tasks.some(old => old.id === row.id));
  assert.ok(newTasks.length > 0);
  for (const task of newTasks) {
    const record = definitions.challenges[task.skill][task.label];
    assert.deepEqual(record.Items ?? [], task.supplyItems ?? []);
    assert.deepEqual(record.Skills ?? {}, task.skillRequirements ?? {});
    assert.deepEqual(record.Output ?? [], task.output ?? []);
    assert.deepEqual(record.Objects ?? [], task.objectRequirements ?? []);
    assert.deepEqual(record.NPCs ?? [], task.npcRequirements ?? []);
    assert.deepEqual(record.Monsters ?? [], (task.monsterRequirements ?? []).map(id => monsterName(batch.monsters.find(row => row.id === id))));
    assert.notEqual(result.tasks.find(row => row.id === task.id)?.status, 'unsupported', task.id);
  }
  for (const drop of batch.drops) {
    const monster = batch.monsters.find(row => row.id === drop.monsterId), name = monsterName(monster);
    assert.equal(definitions.drops[name][drop.item][drop.quantity], drop.rate);
    const source = result.items.find(row => row.name === drop.item)?.sources.find(row => row.kind === 'drop' && row.source === name && row.location === drop.cell && row.quantity === drop.quantity);
    assert.ok(source, `Missing natural drop source: ${drop.id}`);
    assert.equal(source.quantity, drop.quantity);
    assert.equal(source.rate, drop.rate);
    assert.equal(source.probability, drop.probability);
  }
  const withoutMonsters = structuredClone(definitions);
  for (const chunk of Object.values(withoutMonsters.chunks)) delete chunk.Monster;
  assert.ok(!evaluate(withoutMonsters).items.some(item => item.sources.some(source => source.kind === 'drop')));
  let suppliedRecipes = 0;
  for (const recipe of batch.recipes) {
    const acquisition = batch.acquisitions.find(row => row.sourceId === recipe.id);
    const task = newTasks.find(row => row.sourceId === acquisition.id);
    const record = definitions.challenges[task.skill][task.label];
    assert.deepEqual(record.Output, [recipe.item]);
    for (const input of recipe.inputs) assert.ok(record.Items.includes(input.item));
    for (const tool of recipe.tools) assert.ok(record.Items.includes(tool));
    for (const id of recipe.facilityIds) {
      const facility = batch.facilities.find(row => row.id === id);
      assert.ok((facility.kind === 'tanner' ? record.NPCs : record.Objects).includes(facility.name));
    }
    assert.ok(!record.Items.includes(recipe.item), 'A recipe cannot require its own output');
    if (result.items.find(row => row.name === recipe.item)?.sources.some(row => row.taskId === task.id)) {
      suppliedRecipes++;
      for (const required of record.Items) {
        const withoutSupply = structuredClone(definitions);
        for (const stock of Object.values(withoutSupply.shopItems)) delete stock[required];
        for (const drops of Object.values(withoutSupply.drops)) delete drops[required];
        for (const category of Object.values(withoutSupply.challenges)) for (const producer of Object.values(category)) {
          if (producer.Output) producer.Output = producer.Output.filter(item => item !== required);
        }
        assert.ok(!evaluate(withoutSupply).items.find(row => row.name === recipe.item)?.sources.some(row => row.taskId === task.id),
          `Recipe requires every material and tool: ${recipe.id}:${required}`);
      }
      const withoutFacilities = structuredClone(definitions);
      for (const chunk of Object.values(withoutFacilities.chunks)) {
        for (const name of record.Objects ?? []) delete chunk.Object?.[name];
        for (const name of record.NPCs ?? []) delete chunk.NPC?.[name];
      }
      if (record.Objects?.length || record.NPCs?.length) assert.ok(!evaluate(withoutFacilities).items.find(row => row.name === recipe.item)?.sources.some(row => row.taskId === task.id), `Recipe requires its facility: ${recipe.id}`);
    }
    const withoutRecipe = structuredClone(definitions);
    delete withoutRecipe.challenges[task.skill][task.label];
    assert.ok(!evaluate(withoutRecipe).items.find(row => row.name === recipe.item)?.sources.some(row => row.taskId === task.id));
  }
  assert.ok(suppliedRecipes > 0, 'At least one reviewed recipe must supply its exact item through the ordinary task output path');
  assert.ok(state.members.every(row => row.completedTasks.length === 0), 'Supply options must not complete personal tasks');
});

test('authored journal validates and appears as a custom goal for both explorers', () => {
  const state = createGroupState(dataset.gameDefaults.members);
  state.identityRegistry = authoredIdentityRegistry();
  state.tasks = structuredClone(dataset.gameDefaults.tasks);
  assert.equal(state.tasks[0].id, 'custom:open-f2p:journal');
  assert.ok(isPermanentId(state.tasks[0].id));
  assert.equal(resolveTaskAlias(state.tasks[0].label).id, state.tasks[0].id);
  const checked = validateState(state, createRuleRegistry());
  for (const member of checked.members) assert.equal(personalCustomTaskRows([], checked, member)[0].id, state.tasks[0].id);
});

test('provider delivers immutable own inputs and browser contract without invoking legacy defaults', async () => {
  const resolved = await resolveDataset({ datasetId: 'open-f2p', root: '/unavailable', packsDir: '/unavailable', selectionPath: '/unavailable' });
  assert.equal(resolved.digest, dataset.digest);
  assert.equal(dataset.value('app/data/identity-registry.mjs#authoredTasks', () => { throw new Error('Private initializer invoked'); }).length, batch.tasks.length);
  for (const receipt of dataset.files.filter(row => row.kind === 'input')) {
    const bytes = dataset.bytes(receipt.path);
    assert.equal(bytes.length, receipt.bytes);
    assert.equal(sha(bytes), receipt.sha256);
    bytes.fill(0);
    assert.equal(sha(dataset.bytes(receipt.path)), receipt.sha256);
  }
  assert.throws(() => { dataset.gameDefaults.members[0].name = 'Changed'; }, TypeError);
  const categories = dataset.value('app/tasks/engine.mjs#F2P');
  categories.add('Injected');
  assert.ok(!dataset.value('app/tasks/engine.mjs#F2P').has('Injected'));
  const browser = await datasetBrowserPayload(dataset);
  assert.equal(browser.dataset.datasetId, 'open-f2p', 'Browser identity validation needs the selected contract ID');
  assert.equal(browser.dataset.identityNamespace, 'rs3:open-f2p');
  assert.deepEqual(browser.dataset.coverage, batch.coverage);
  await assert.rejects(resolveDataset({ datasetId: 'open-f2p', digest: '0'.repeat(64) }), { code: 'DATASET_PACK_INVALID' });
});

test('shared world and task engines compile only the reviewed F2P rows and walking links', async () => {
  const { definitionBytes } = await loadDatasetInputs(dataset);
  const definitions = JSON.parse(definitionBytes);
  const world = buildWorld(definitions, { dataset });
  const engine = createTaskEngine(definitions, { dataset });
  assert.deepEqual(world.issues, []);
  assert.equal(world.surface.size, batch.cells.length);
  assert.ok(world.chunks.has(dataset.gameDefaults.startingCell));
  assert.deepEqual(new Set(engine.catalogue.map(row => row.id)), new Set(batch.tasks.map(row => row.id)));
  for (const cell of batch.cells) assert.ok(surfaceCoordinates(cell.id));
  for (const edge of batch.connections) {
    assert.ok(world.sectionTopology.get(edge.from).get('0').includes(edge.to));
    assert.ok(world.sectionTopology.get(edge.to).get('0').includes(edge.from));
  }
  for (const route of batch.routes) {
    assert.equal(route.mode, 'boat'); assert.equal(route.fare, 30);
    assert.ok(route.requirements.length > 0);
    assert.ok(!definitions.sections[route.from]['0'].includes(route.to), 'Conditional boat route cannot become a walking edge');
    assert.ok(!definitions.sections[route.to]['0'].includes(route.from), 'Conditional boat route cannot become a reciprocal walking edge');
    assert.ok(!batch.connections.some(edge => [edge.from, edge.to].includes(route.from) && [edge.from, edge.to].includes(route.to)));
  }
});

test('reviewed paths reach 40 original cells and every remaining cell has an explicit review reason', () => {
  const reachable = new Set(['12850']);
  for (let previous = -1; previous !== reachable.size;) {
    previous = reachable.size;
    for (const { from, to } of batch.connections) {
      if (reachable.has(from)) reachable.add(to);
      if (reachable.has(to)) reachable.add(from);
    }
  }
  const original = baseline.cells.filter(row => reachable.has(row.id)).map(row => row.id).sort();
  assert.equal(original.length, 40);
  assert.deepEqual(original, spec.walking.reviewedOriginalReachable);
  assert.equal(original.length, spec.walking.reviewedOriginalReachableCount);
  assert.equal(reachable.size, 44);
  const manual = batch.cells.filter(row => !reachable.has(row.id)).map(row => row.id).sort();
  assert.deepEqual(manual, spec.walking.manualCells.map(row => row.cell).sort());
  assert.ok(spec.walking.manualCells.every(row => row.reason.length > 30));
  assert.ok(!reachable.has('11569'), 'The mainland graph must not admit Musa Point fishing');
  const reviewedExclusions = new Set(spec.walking.exclusionEvidence.flatMap(row => row.cellIds));
  assert.deepEqual([...reviewedExclusions].sort(), manual);
});

test('provider gathering gates use reviewed shop tools and bait through the existing source evaluator', () => {
  const definitions = dataset.json('app/datasets/open-f2p/definitions.json');
  const state = createGroupState(dataset.gameDefaults.members);
  state.taskRules = { F2P: true, Mining: true, Woodcutting: true, Fishing: true, Extra: true };
  state.members[0].unlocked = batch.cells.map(row => row.id);
  const member = state.members[0].id;
  const evaluate = data => createTaskEngine(data, { dataset }).evaluate(state, member);
  const all = evaluate(definitions);
  assert.ok(all.items.some(row => row.name === 'Coins' && row.sources.some(source => source.kind === 'drop')), 'Reviewed encounters establish possible coin drops');
  const withoutCoinDrops = structuredClone(definitions);
  for (const table of Object.values(withoutCoinDrops.drops)) delete table.Coins;
  const noFare = evaluate(withoutCoinDrops);
  assert.ok(!noFare.items.some(row => row.name === 'Coins'), 'Absent reviewed coin sources cannot supply a fare');
  for (const route of batch.routes) {
    const tasks = batch.tasks.filter(row => row.sourceId === route.id);
    assert.equal(tasks.length, 2, `Both reviewed directions require conditional activities: ${route.id}`);
    assert.deepEqual(new Set(tasks.map(row => row.cell)), new Set([route.from, route.to]));
    for (const task of tasks) {
      assert.ok(definitions.challenges.Extra[task.label].Items.includes('Coins'));
      assert.equal(noFare.tasks.find(row => row.id === task.id).status, 'blocked', 'A fare requires admitted coin supply');
    }
  }
  for (const stock of batch.stock) {
    const shop = batch.shops.find(row => row.id === stock.shopId);
    assert.equal(definitions.chunks[stock.cell].Shop[shop.name], true);
    assert.ok(definitions.shopItems[shop.name][stock.item] > 0);
    const item = all.items.find(row => row.name === stock.item);
    assert.ok(item?.sources.some(source => source.kind === 'shop' && source.source === shop.name && source.location === stock.cell), stock.item);
  }
  for (const source of batch.sources) {
    const task = batch.tasks.find(row => row.sourceId === source.id);
    const record = definitions.challenges[source.skill][task.label];
    assert.ok(record.Items?.length, `Missing tool gate: ${source.id}`);
    if (source.skill === 'Mining') assert.ok(record.Items.includes('Pickaxe[+]'));
    if (source.skill === 'Woodcutting') assert.ok(record.Items.includes('Hatchet[+]'));
  }
  const baitSource = batch.sources.find(row => row.slug === 'sardine');
  assert.ok(baitSource, 'The retained bait method must exist');
  const baitTask = batch.tasks.find(row => row.sourceId === baitSource.id);
  assert.deepEqual(definitions.challenges.Fishing[baitTask.label].Items, ['Fishing rod', 'Fishing bait']);
  assert.equal(all.tasks.find(row => row.id === baitTask.id).status, 'available');
  for (const missing of ['Fishing rod', 'Fishing bait']) {
    const without = structuredClone(definitions);
    for (const stock of Object.values(without.shopItems)) delete stock[missing];
    const result = evaluate(without);
    assert.ok(!result.items.some(row => row.name === missing));
    assert.equal(result.tasks.find(row => row.id === baitTask.id).status, 'blocked', `${missing} is required independently`);
  }
  const noShops = structuredClone(definitions);
  for (const chunk of Object.values(noShops.chunks)) delete chunk.Shop;
  const none = evaluate(noShops);
  assert.ok(!none.items.some(row => row.sources.some(source => source.kind === 'shop')));
  for (const task of batch.tasks.filter(row => ['Mining', 'Woodcutting', 'Fishing'].includes(row.skill))) {
    assert.equal(none.tasks.find(row => row.id === task.id).status, 'blocked', task.id);
  }
});

test('batch 3 gathering additions retain exact levels, reviewed places and their own provenance', () => {
  const expected = [
    ['dead-tree', 'Woodcutting', 1, 'Logs'],
    ['maple', 'Woodcutting', 40, 'Maple logs'],
    ['yew', 'Woodcutting', 70, 'Yew logs'],
    ['acadia', 'Woodcutting', 50, 'Acadia logs'],
    ['lobster', 'Fishing', 40, 'Raw lobster'],
    ['tuna', 'Fishing', 35, 'Raw tuna'],
    ['swordfish', 'Fishing', 50, 'Raw swordfish'],
  ];
  const oldSources = new Set(baseline2.sources.map(row => row.id));
  for (const [slug, skill, level, output] of expected) {
    const rows = batch.sources.filter(row => row.slug === slug);
    assert.ok(rows.length, `Missing reviewed gathering addition: ${slug}`);
    for (const source of rows) {
      assert.ok(!oldSources.has(source.id));
      assert.equal(source.skill, skill);
      assert.equal(source.level, level);
      assert.equal(source.output, output);
      assert.ok(source.places.length && source.places.every(place => typeof place === 'string' && place.length));
      const task = batch.tasks.find(row => row.sourceId === source.id);
      assert.ok(task);
      assert.equal(task.level, level);
      if (skill === 'Fishing') {
        assert.ok(source.places.includes('Musa Point'));
        assert.deepEqual(task.supplyItems, [slug === 'lobster' ? 'Lobster pot' : 'Harpoon']);
      }
    }
  }
  const oldMinePages = new Set(baseline2.sources.filter(row => row.skill === 'Mining').flatMap(row => row.provenance.map(receipt => receipt.page)));
  const newMines = spec.mines.filter(title => !oldMinePages.has(title));
  assert.ok(newMines.length, 'Batch 3 must review additional surface mines');
  assert.ok(batch.sources.some(row => row.skill === 'Mining' && !oldSources.has(row.id)
    && row.provenance.some(receipt => newMines.includes(receipt.page))), 'A new mine must support an admitted gathering source');
});

test('Lumbridge starts Woodcutting through reviewed level-one trees and shops without completion evidence', () => {
  const definitions = dataset.json('app/datasets/open-f2p/definitions.json');
  const state = createGroupState(dataset.gameDefaults.members);
  state.taskRules = { F2P: true, Woodcutting: true, Mining: true, Fishing: true, Extra: true };
  for (const member of state.members) member.unlocked = [];
  const member = state.members[0];
  member.unlocked = ['12850'];
  assert.ok(state.members.every(row => row.completedTasks.length === 0));
  const evaluate = data => createTaskEngine(data, { dataset }).evaluate(state, member.id);
  const source = batch.sources.find(row => row.skill === 'Woodcutting' && row.level === 1 && row.cell === '12850' && row.output === 'Logs');
  assert.ok(source, 'Starting access needs a precisely located level-one log source');
  const startingTask = batch.tasks.find(row => row.sourceId === source.id);
  const oakSource = batch.sources.find(row => row.slug === 'oak' && row.cell === '12850');
  const oak = batch.tasks.find(row => row.sourceId === oakSource?.id);
  assert.ok(oak, 'Retain the starting-cell oak activity');
  const available = evaluate(definitions);
  assert.equal(available.tasks.find(row => row.id === startingTask.id).status, 'available');
  assert.equal(available.training.Woodcutting.primary, true);
  assert.equal(available.tasks.find(row => row.id === oak.id).status, 'available');
  const withoutStarter = structuredClone(definitions);
  for (const task of batch.tasks.filter(row => row.skill === 'Woodcutting' && row.level === 1)) delete withoutStarter.challenges.Woodcutting[task.label];
  const blocked = evaluate(withoutStarter);
  assert.equal(blocked.training.Woodcutting.primary, false);
  assert.equal(blocked.tasks.find(row => row.id === oak.id).status, 'blocked');
  const withoutTools = structuredClone(definitions);
  for (const chunk of Object.values(withoutTools.chunks)) delete chunk.Shop;
  const noTools = evaluate(withoutTools);
  assert.equal(noTools.tasks.find(row => row.id === startingTask.id).status, 'blocked');
  assert.equal(noTools.training.Woodcutting.primary, false);
  assert.ok(state.members.every(row => row.completedTasks.length === 0));
});

test('cage and harpoon fishing require their respective reviewed tools', () => {
  const definitions = dataset.json('app/datasets/open-f2p/definitions.json');
  const state = createGroupState(dataset.gameDefaults.members);
  state.taskRules = { F2P: true, Fishing: true, Mining: true, Woodcutting: true, Extra: true };
  state.members[0].unlocked = batch.cells.map(row => row.id);
  for (const slug of ['lobster', 'tuna', 'swordfish']) {
    const source = batch.sources.find(row => row.slug === slug);
    assert.ok(source);
    const task = batch.tasks.find(row => row.sourceId === source.id);
    const tool = slug === 'lobster' ? 'Lobster pot' : 'Harpoon';
    const evaluate = data => createTaskEngine(data, { dataset }).evaluate(state, state.members[0].id);
    assert.equal(evaluate(definitions).tasks.find(row => row.id === task.id).status, 'available');
    const withoutTool = structuredClone(definitions);
    for (const stock of Object.values(withoutTool.shopItems)) delete stock[tool];
    assert.equal(evaluate(withoutTool).tasks.find(row => row.id === task.id).status, 'blocked', `${slug} needs ${tool}`);
  }
});

test('open-f2p folder contains only declared authored and attributed Wiki-derived assets', async () => {
  const allowed = new Set(['authored/batch.json', 'wiki-derived/dataset.json', 'wiki-derived/baseline-0.1.0.json', 'wiki-derived/baseline-0.2.0.json', 'wiki-derived/baseline-0.3.0.json', 'wiki-derived/baseline-0.4.0.json', 'wiki-derived/NOTICE']);
  const seen = [];
  async function scan(directory, prefix = '') {
    for (const row of await readdir(directory, { withFileTypes: true })) {
      const name = prefix + row.name;
      assert.ok(!row.isSymbolicLink(), 'Dataset assets cannot be linked to private input');
      if (row.isDirectory()) await scan(path.join(directory, row.name), name + '/');
      else { assert.ok(allowed.has(name), `Unexpected dataset asset: ${name}`); seen.push(name); }
    }
  }
  await scan(folder);
  assert.deepEqual(seen.sort(), [...allowed].sort());
});

test('authored F2P selection and generated facts contain no forbidden input references', async () => {
  const forbidden = /reference[\\/]original-picker|rs3-chunkpicker-chunkinfo-export|tasksMap\.json|private(?:[-_ ](?:test|profile|identity|data))|\.local[\\/](?:duo|private)|maps[\\/][\w-]+\.json|firebaseio/i;
  for (const filename of [authored, datasetPath, path.join(root, 'app/open-f2p.mjs'), ...['build-open-f2p.mjs', 'lib/open-f2p-receipt.mjs', 'lib/open-f2p-services.mjs', 'lib/open-f2p-walking.mjs', 'lib/open-f2p-stories.mjs', 'lib/open-f2p-equipment.mjs'].map(name => path.join(root, 'scripts', name))]) {
    assert.doesNotMatch(await readFile(filename, 'utf8'), forbidden, `Forbidden input reference in ${path.relative(root, filename)}`);
  }
});

test('walking rejects missing evidence, gates without free membership and nonadjacent approaches', () => {
  const provenance = { page: 'Path', revision: 1, url: 'https://runescape.wiki/w/Path?oldid=1' };
  const text = '{{Place|members=no|x=3200|y=3200|plane=0}} walk east';
  const pages = new Map([['Path', { text, provenance }]]);
  const point = { x: 3200, y: 3200, id: '12850', provenance };
  const run = walking => buildWalking({ spec: { bounds: { minX: 3000, maxX: 3400, minY: 3000, maxY: 3400 }, walking }, pages,
    anchors: new Map([['Origin', point], ['Neighbour', { ...point, x: 3264, id: '13106' }], ['Distant', { ...point, x: 3328, id: '13362' }]]),
    addCell: coordinate => chunkId(coordinate.x, coordinate.y) });
  const edge = { from: 'Origin', to: 'Neighbour', reason: 'Reviewed path', evidence: [{ page: 'Path', needle: 'walk east' }] };
  assert.equal(run({ anchors: [], edges: [edge] }).length, 1);
  assert.throws(() => run({ anchors: [], edges: [{ ...edge, evidence: [] }] }), /evidence missing/);
  assert.throws(() => run({ anchors: [], edges: [{ ...edge, evidence: [{ page: 'Path', needle: 'unreviewed gate' }] }] }), /evidence changed/);
  assert.throws(() => run({ anchors: [], edges: [{ ...edge, to: 'Distant' }] }), /adjacent reviewed cells/);
  const anchor = { name: 'Unproven', page: 'Path', needle: text, x: 3200, y: 3200, membership: { page: 'Path', needle: 'walk east' } };
  assert.throws(() => run({ anchors: [anchor], edges: [] }), /explicit free evidence/);
});

test('balanced templates preserve nested gates and reject unfinished templates', () => {
  const gated = '{{ObjectLocLine|loc=Gated|requirements={{QuestReq|Example|{{Level|Mining|10}}}}|mem=no|map=x:3200, y:3200}}';
  assert.deepEqual(templates(gated, 'ObjectLocLine'), [gated]);
  assert.throws(() => templates('{{ObjectLocLine|requirements={{QuestReq|Example}}', 'ObjectLocLine'), /Unclosed/);
});

test('synthetic facilities omit zero, unknown, member and gated stock and preserve service floors', () => {
  const stockLine = parameters => `{{StoreLine|${parameters}}}`;
  const location = parameters => `{{ObjectLocLine|name=Deposit box|loc=River|map=x:3200, y:3200|${parameters}}}`;
  const texts = {
    Shop: '{{Infobox Shop|name=Fixture shop|members=no|map={{NPC map|x=3200|y=3200|plane=0}}}}' + [
      stockLine('name=Tool|members=no|stock=3|sell=5'),
      stockLine('name=Tool|members=no|stock=1|sell=Free'),
      stockLine('name=Zero|members=no|stock=0|sell=5'),
      stockLine('name=Unknown stock|members=no|stock=Unlimited|sell=5'),
      stockLine('name=Unknown price|members=no|stock=3|sell=Unknown'),
      stockLine('name=Member|members=yes|stock=3|sell=5'),
      stockLine('name=Unproven membership|stock=3|sell=5'),
      stockLine('name=Gated|members=no|stock=3|sell=5|requirements={{QuestReq|Example|{{Level|Mining|10}}}}'),
    ].join('\n'),
    'Deposit box': [location('mem=no|mapID=28|plane=0|requirements=None'),
      location('mem=yes|mapID=28|plane=0'), location('mem=no|mapID=99|plane=0'),
      location('mem=no|mapID=28|plane=1'), location('mem=no|mapID=28|plane=0|requirements={{QuestReq|Example}}')].join('\n'),
    Bank: '{{Infobox Location|members=no|map={{Area map|x=3201|y=3201|plane=1}}}}',
  };
  const pages = new Map(Object.entries(texts).map(([title, text], index) => [title,
    { text, provenance: { page: title, revision: index + 1, url: `https://runescape.wiki/w/${encodeURIComponent(title)}?oldid=${index + 1}` } }]));
  const spec = { shops: [{ page: 'Shop', slug: 'fixture' }], banks: [{ page: 'Bank', slug: 'floor-bank', plane: 1 }],
    serviceLocations: [{ page: 'Deposit box', kind: 'deposit-box', locations: ['River'] }] };
  const run = selection => buildServices({ spec: selection, pages, anchors: new Map(), addCell: point => chunkId(point.x, point.y) });
  const result = run(spec);
  assert.equal(result.shops.length, 1);
  assert.deepEqual(result.stock.map(row => [row.item, row.stock, row.price, row.variant]).sort(),
    [['Tool', 1, 0, 'free'], ['Tool', 3, 5, 'standard']]);
  assert.equal(result.services.length, 2);
  const deposit = result.services.find(row => row.kind === 'deposit-box'), bank = result.services.find(row => row.kind === 'bank');
  assert.equal(deposit.coordinates.length, 1);
  assert.equal(deposit.coordinates[0].plane, 0);
  assert.match(deposit.access, /does not withdraw/);
  assert.equal(bank.coordinates[0].plane, 1);
  assert.throws(() => run({ ...spec, banks: [{ page: 'Bank', slug: 'floor-bank', plane: 0 }] }), /plane mismatch/);
  assert.deepEqual(run({}), { shops: [], stock: [], services: [], routes: [], tasks: [] });
});

test('minimal pinned fixture generates deterministically and excludes gated/member/interior locations', async t => {
  const directory = await scratch(t), cacheDir = path.join(directory, 'cache');
  const generator = path.join(directory, 'scripts/build-open-f2p.mjs');
  const authoredFile = path.join(directory, 'app/datasets/open-f2p/authored/batch.json');
  await mkdir(path.dirname(generator), { recursive: true });
  await mkdir(path.join(path.dirname(generator), 'lib'), { recursive: true });
  await mkdir(path.dirname(authoredFile), { recursive: true });
  await mkdir(cacheDir);
  await copyFile(path.join(root, 'scripts/build-open-f2p.mjs'), generator);
  await copyFile(path.join(root, 'scripts/lib/open-f2p-receipt.mjs'), path.join(path.dirname(generator), 'lib/open-f2p-receipt.mjs'));
  await copyFile(path.join(root, 'scripts/lib/open-f2p-services.mjs'), path.join(path.dirname(generator), 'lib/open-f2p-services.mjs'));
  await copyFile(path.join(root, 'scripts/lib/open-f2p-stories.mjs'), path.join(path.dirname(generator), 'lib/open-f2p-stories.mjs'));
  await copyFile(path.join(root, 'scripts/lib/open-f2p-walking.mjs'), path.join(path.dirname(generator), 'lib/open-f2p-walking.mjs'));
  await copyFile(path.join(root, 'scripts/lib/open-f2p-equipment.mjs'), path.join(path.dirname(generator), 'lib/open-f2p-equipment.mjs'));
  const point = 'x:3200, y:3200', nested = '{{QuestReq|Example|{{Level|Mining|10}}}}';
  const treeRow = extra => `{{ObjectLocLine|loc=Forest|${extra}|map=${point}}}`;
  const fishRow = extra => `{{FishingSpotLocLine|loc=River|${extra}|map=${point}}}`;
  const texts = {
    Origin: '{{Place|members=no|x=3200|y=3200}} walk east',
    Destination: '{{Place|members=no|x=3264|y=3200}}',
    'Free mine': '{{Place|members=no|x=3200|y=3200}}',
    'Gated mine': '{{Place|members=no|x=3264|y=3200|requirements={{QuestReq|Example}}}}',
    Oak: '{{Object|members=no|level=15}}' + [treeRow('mem=no|requirements=None|plane=0|mapID=28'),
      treeRow(`requirements=${nested}|mem=no`), treeRow('mem=yes'), treeRow('mem=no|plane=1'), treeRow('mem=no|mapID=99'), treeRow('requirements=None')].join('\n'),
    'Iron rock': '{{Object|members=no|level=10}}{{RockLocLine|site=Free mine|requirements=None|mapID=28|map=' + point + '}}' +
      '{{RockLocLine|site=Unreviewed mine|map=x:3264, y:3200}}' + '{{RockLocLine|site=Gated mine|map=x:3264, y:3200}}' +
      `{{RockLocLine|site=Free mine|requirements=${nested}|map=x:3264, y:3200}}`,
    Fish: '{{Fishing info|level=1}}' + [fishRow('requirements=None|mem=no|mapID=28'), fishRow(`requirements=${nested}|mem=no|mapID=28`),
      fishRow('requirements=None|mem=yes|mapID=28'), fishRow('requirements=None|mem=no|mapID=99')].join('\n'),
    'Template:Map/doc': 'Synthetic coordinate explanation',
    'RuneScape:Map': 'Synthetic map explanation',
  };
  const pages = Object.keys(texts).map((title, index) => ({ requestedTitle: title, title, revision: index + 1 }));
  const fixture = { schemaVersion: 1, id: 'open-f2p', version: '0.1.0', pages, bounds: { minX: 3136, maxX: 3327, minY: 3136, maxY: 3327 },
    places: ['Origin', 'Destination'], mines: ['Free mine', 'Gated mine'],
    types: [{ page: 'Oak', slug: 'oak', skill: 'Woodcutting', template: 'ObjectLocLine', output: 'Oak logs', tool: 'hatchet' },
      { page: 'Iron rock', slug: 'iron', skill: 'Mining', template: 'RockLocLine', output: 'Iron ore', tool: 'pickaxe' }],
    fishing: [{ page: 'Fish', fish: [['crayfish', 'Raw crayfish', 'crayfish cage']] }],
    connections: [{ from: 'Origin', to: 'Destination', evidence: 'Origin', needle: 'walk east', reason: 'Fixture walking evidence' }], omitted: ['Synthetic fixture'] };
  await writeFile(authoredFile, JSON.stringify(fixture));
  for (const pin of pages) await writeFile(path.join(cacheDir, cacheFilename(pin.title)), JSON.stringify({ requestedTitle: pin.title,
    api: 'https://runescape.wiki/api.php?fixture=1', page: { title: pin.title, revisions: [{ revid: pin.revision, slots: { main: { contentmodel: 'wikitext', content: texts[pin.title] } } }] } }));
  const first = await guardedBuild({ generator, authoredFile, pins: pages, cacheDir, outputDir: path.join(directory, 'out-1'), probes: true });
  const second = await guardedBuild({ generator, authoredFile, pins: pages, cacheDir, outputDir: path.join(directory, 'out-2') });
  assert.equal(first.bytes, second.bytes);
  assert.equal(first.dataset.sources.length, 3);
  assert.equal(first.dataset.tasks.length, 3);
  assert.equal(first.dataset.cells.length, 2);
  assert.equal(first.dataset.connections.length, 1);
  assert.ok(first.dataset.sources.every(row => row.cell === '12850'));
  // Pin validation fails before facts can be emitted.
  const badPin = path.join(cacheDir, cacheFilename('Oak'));
  const cached = JSON.parse(await readFile(badPin, 'utf8'));
  cached.page.revisions[0].revid++;
  await writeFile(badPin, JSON.stringify(cached));
  await assert.rejects(guardedBuild({ generator, authoredFile, pins: pages, cacheDir, outputDir: path.join(directory, 'bad-pin') }), /Pinned Wiki response mismatch/);
});

test('available real pinned cache rebuilds committed facts byte-for-byte with audited input reads', async t => {
  const cacheDir = path.join(root, '.local/wiki-open-f2p');
  try { for (const pin of spec.pages) await access(path.join(cacheDir, cacheFilename(pin.requestedTitle))); }
  catch (error) { if (error.code === 'ENOENT') { t.skip('Optional pinned local cache is absent; synthetic offline build remains mandatory.'); return; } throw error; }
  const directory = await scratch(t);
  const result = await guardedBuild({ generator: path.join(root, 'scripts/build-open-f2p.mjs'), authoredFile: authored,
    pins: spec.pages, cacheDir, outputDir: path.join(directory, 'output') });
  assert.equal(result.bytes, batchBytes.toString());
  assert.equal(result.dataset.buildInputs.authored.sha256, sha(await readFile(authored)));
  for (const quest of batch.quests) {
    const cached = JSON.parse(await readFile(path.join(cacheDir, cacheFilename(quest.page)), 'utf8'));
    const text = cached.page.revisions[0].slots.main.content;
    const details = templateFields(templates(text, 'Quest details')[0]);
    const rewards = templateFields(templates(text, 'Quest rewards')[0]);
    assert.equal(quest.questPoints, Number(rewards.qp), `Quest points differ from Wiki: ${quest.page}`);
    const needs = [...(details.requirements ?? '').matchAll(/\{\{Skillreq\|([^|}]+)\|(\d+)/gi)];
    const skills = Object.fromEntries(needs.filter(match => match[1] !== 'Quest points').map(match => [match[1], Number(match[2])]));
    assert.deepEqual(quest.skillRequirements, skills, `Mandatory skills differ from Wiki: ${quest.page}`);
    assert.equal(quest.questPointsNeeded, needs.find(match => match[1] === 'Quest points')?.[2] === undefined ? undefined
      : Number(needs.find(match => match[1] === 'Quest points')[2]), `Quest-point gate differs from Wiki: ${quest.page}`);
  }
  for (const review of spec.walking.exclusionEvidence) for (const proof of review.evidence) {
    assert.ok(spec.pages.some(pin => pin.requestedTitle === proof.page), `Unpinned exclusion: ${proof.page}`);
    const cached = JSON.parse(await readFile(path.join(cacheDir, cacheFilename(proof.page)), 'utf8'));
    assert.ok(cached.page.revisions[0].slots.main.content.includes(proof.needle), `Exclusion evidence changed: ${proof.page}`);
  }
});
