import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

process.env.RS3_DATASET = 'open-f2p';
const batch = JSON.parse(await readFile(new URL('../app/datasets/open-f2p/wiki-derived/dataset.json', import.meta.url)));
const { selectedDataset: dataset } = await import('../app/dataset-runtime.mjs');
const { createGroupState } = await import('../app/core/state.mjs');
const { createTaskEngine } = await import('../app/tasks/engine.mjs');
const { buildOrdinarySupplies } = await import('../scripts/lib/open-f2p-services.mjs');
const definitions = dataset.json('app/datasets/open-f2p/definitions.json');
const evaluate = (defs = definitions, cells = batch.cells.map(row => row.id)) => {
  const state = createGroupState(dataset.gameDefaults.members);
  state.members[0].unlocked = cells;
  return createTaskEngine(defs, { dataset }).evaluate(state, state.members[0].id);
};

test('reviewed wild onions and potatoes supply renewable items without Farming', () => {
  assert.equal(batch.harvests?.length, 3);
  for (const [cell, item] of [['12338', 'Onion'], ['12595', 'Raw potato'], ['13107', 'Raw potato']]) {
    const harvest = batch.harvests.find(row => row.cell === cell && row.item === item);
    assert.ok(harvest, `${cell}: ${item}`);
    const task = batch.tasks.find(row => row.sourceId === harvest.id);
    const record = definitions.challenges.Extra[task.label];
    assert.deepEqual(record.Objects, [harvest.name]);
    assert.deepEqual(record.Output, [item]);
    assert.equal(record.Skills, undefined);
    assert.equal(record.Items, undefined);
    const result = evaluate(definitions, [cell]);
    assert.ok(result.items.find(row => row.name === item)?.sources.some(row => row.taskId === task.id));
    assert.ok(!result.training.Farming?.primary);
    const absent = structuredClone(definitions);
    delete absent.chunks[cell].Object[harvest.name];
    assert.ok(!evaluate(absent, [cell]).items.find(row => row.name === item)?.sources.some(row => row.taskId === task.id));
  }
});

test('public dialogue supplies preserve exact alternative payments and admitted NPCs', () => {
  assert.equal(batch.dialogueSupplies?.length, 2);
  for (const [npc, item, alternatives] of [['Ned', 'Rope', [{ Coins: 15 }, { 'Ball of wool': 4 }]], ['Karim', 'Kebab', [{ Coins: 1 }]]]) {
    const supply = batch.dialogueSupplies.find(row => row.name === npc);
    const task = batch.tasks.find(row => row.sourceId === supply.id);
    const record = definitions.challenges.Extra[task.label];
    assert.deepEqual(record.DialogueSupply, { mode: 'closure-only', paymentAlternatives: alternatives });
    assert.deepEqual(record.NPCs, [npc]);
    assert.deepEqual(record.Output, [item]);
    assert.equal(record.Shops, undefined);
    assert.ok(!Object.hasOwn(definitions.shopItems, npc));
    const unpaid = evaluate(definitions, [supply.cell]);
    assert.ok(!unpaid.items.find(row => row.name === item)?.sources.some(row => row.taskId === task.id));
    for (const alternative of alternatives) {
      const paid = structuredClone(definitions);
      paid.challenges.Extra['Fixture payment capability'] = { Chunks: [supply.cell], Output: Object.keys(alternative) };
      assert.ok(evaluate(paid, [supply.cell]).items.find(row => row.name === item)?.sources.some(row => row.taskId === task.id));
      delete paid.chunks[supply.cell].NPC[npc];
      assert.ok(!evaluate(paid, [supply.cell]).items.find(row => row.name === item)?.sources.some(row => row.taskId === task.id));
    }
  }
});

test('Ernest rewards remain finite metadata and never renewable item sources', () => {
  const task = batch.tasks.find(row => row.id === 'rs3:open-f2p:activity:quest:ernest-the-chicken');
  const record = definitions.challenges.Quest[task.label];
  assert.deepEqual(record.FiniteRewards, [{ item: 'Coins', quantity: 3000 }, { item: 'Egg', quantity: 10 }, { item: 'Feather', quantity: 300 }]);
  assert.equal(record.Output, undefined);
  const result = evaluate();
  assert.ok(!result.items.some(row => row.sources.some(source => source.taskId === task.id)));
  const rewards = result.finiteRewards.filter(row => row.taskId === task.id);
  assert.equal(rewards.length, 3);
  assert.ok(rewards.every(row => row.status === 'completion-blocked' && row.renewable === false && row.remainingQuantity === null && row.claimStatus === 'untracked'), 'Unreviewed manor interiors keep their existing manual gates');
  const confirmedInteriorsFixture = structuredClone(definitions);
  delete confirmedInteriorsFixture.challenges.Quest[task.label].ManualChecks;
  assert.ok(evaluate(confirmedInteriorsFixture).finiteRewards.filter(row => row.taskId === task.id).every(row => row.status === 'attainable-on-completion'));
  const state = createGroupState(dataset.gameDefaults.members);
  state.members[0].unlocked = batch.cells.map(row => row.id);
  state.members[0].completedTasks = [task.id];
  const completed = createTaskEngine(definitions, { dataset }).evaluate(state, state.members[0].id);
  assert.ok(completed.finiteRewards.filter(row => row.taskId === task.id).every(row => row.status === 'completion-recorded' && row.remainingQuantity === null));
  assert.ok(!completed.items.some(row => row.sources.some(source => source.taskId === task.id)));
});

test('ordinary supply review rejects changed payments, membership, gates and locations', () => {
  const texts = {
    Plant: '{{Infobox Scenery|name=Plant|members=No|options=Pick, Examine}}\nRenewable plant.\n{{ObjectLocLine|name=Plant|loc=Field|mem=No|x:3201,y:3201}}\n{{DropsLineSearch|name=Crop|quantity=1|rarity=Common}}',
    Seller: '{{Infobox NPC|name=Seller|members1=No|map1={{NPC map|x=3201|y=3201}}}}\nSells Crop for coins.\n{{StoreLine|name=Crop|stock=inf|sell=2}}',
  };
  const pages = new Map(Object.entries(texts).map(([title, text], i) => [title, { text, provenance: { page: title, revision: i + 1, url: `https://runescape.wiki/w/${title}?oldid=${i + 1}` } }]));
  const spec = {
    ordinaryHarvests: [{ slug: 'plant', page: 'Plant', cell: '12850', location: 'Field', item: 'Crop', label: 'Pick a crop', evidence: [{ page: 'Plant', needle: 'Renewable plant.' }] }],
    dialogueSupplies: [{ slug: 'seller', page: 'Seller', variant: '1', cell: '12850', item: 'Crop', label: 'Buy a crop', reason: 'Pay 2 coins.', paymentAlternatives: [{ Coins: 2 }], evidence: [{ page: 'Seller', needle: 'Sells Crop for coins.' }] }],
  };
  const run = (selection = spec, input = pages) => buildOrdinarySupplies({ spec: selection, pages: input, cells: new Map([['12850', {}], ['13106', {}]]) });
  assert.equal(run().tasks.length, 2);
  assert.throws(() => run({ ...spec, dialogueSupplies: [{ ...spec.dialogueSupplies[0], paymentAlternatives: [{ Coins: 1 }] }] }), /payment differs/);
  assert.throws(() => run({ ...spec, dialogueSupplies: [{ ...spec.dialogueSupplies[0], cell: '13106' }] }), /payment\/location/);
  assert.throws(() => run({ ...spec, ordinaryHarvests: [{ ...spec.ordinaryHarvests[0], cell: '13106' }] }), /no placement/);
  const changed = (page, before, after) => new Map([...pages].map(([title, row]) => [title, title === page ? { ...row, text: row.text.replace(before, after) } : row]));
  assert.throws(() => run(spec, changed('Seller', 'members1=No', 'members1=Yes')), /explicit free/);
  assert.throws(() => run(spec, changed('Plant', 'loc=Field', 'loc=Field|requirements=Quest')), /location changed/);
  assert.throws(() => run(spec, changed('Plant', 'quantity=1', 'quantity=2')), /output changed/);
  assert.throws(() => run(spec, changed('Plant', 'Renewable plant.', 'Gone.')), /evidence changed/);
});

test('public slice explicitly leaves candle sellers, silk theft and members locations unmodelled', () => {
  assert.ok(!batch.tasks.some(row => /Handles for Forks|silk stall/i.test(row.label)));
  assert.ok(!batch.cells.some(row => ['11061', '16435', '16436', '16692', '10547', '13878', '13613'].includes(row.id)));
});
