import test from 'node:test';
import assert from 'node:assert/strict';
import { equipmentChoices, createEquipmentRecorder } from '../app/web/bis-recorded.mjs';
import { readBiSPreferences, writeBiSPreferences } from '../app/web/bis-preferences.mjs';
import { loadBiSMemberResult } from '../app/web/bis-results.mjs';

test('equipment search offers canonical known choices, never typed free text', () => {
  const definitions = { 'Rune pickaxe': { slot: 'main hand weapon' }, 'Bronze pickaxe': {}, 'Rune arrow': {} };
  assert.deepEqual(equipmentChoices(definitions, 'PICK rune').map(row => row.name), ['Rune pickaxe']);
  assert.deepEqual(equipmentChoices(definitions, 'unknown'), []);
  assert.deepEqual(equipmentChoices(definitions, 'rune', ['Rune pickaxe']).map(row => row.name), ['Rune arrow']);
});

test('hide obtained is a browser preference and malformed/unavailable storage uses a safe default', () => {
  let saved;
  const storage = { getItem: () => saved, setItem: (_, value) => { saved = value; } };
  assert.equal(readBiSPreferences(storage).hideObtained, false);
  writeBiSPreferences({ hideObtained: true }, storage);
  assert.equal(readBiSPreferences(storage).hideObtained, true);
  saved = '{broken'; assert.equal(readBiSPreferences(storage).hideObtained, false);
  saved = '{"hideObtained":"true"}'; assert.equal(readBiSPreferences(storage).hideObtained, false);
  const unavailable = { getItem() { throw Error(); }, setItem() { throw Error(); } };
  assert.equal(readBiSPreferences(unavailable).hideObtained, false);
  assert.doesNotThrow(() => writeBiSPreferences({ hideObtained: true }, unavailable));
});

test('partner BiS reuses every existing full cache and falls back to the duo details loader for compact results', async () => {
  const result = { memberId: 'b', stateRevision: 7, currentBiS: {} };
  for (const cache of [{ fullResult: result }, { result }, { duoDetails: new Map([['7:b', result]]) }, { normalPlayResults: new Map([['b', result]]) }, { duoResultCache: { results: () => new Map([['b', result]]) } }]) {
    const screen = { state: { revision: 7, members: [{ id: 'b' }] }, ...cache, ensureDuoDetails() { assert.fail('cache should be reused'); } };
    assert.equal(await loadBiSMemberResult(screen, 'b'), result);
  }
  let calls = 0;
  const screen = { state: { revision: 7, members: [{ id: 'b' }] }, result: { memberId: 'b', stateRevision: 7, format: 'play-v1' }, async ensureDuoDetails(...args) { calls++; assert.deepEqual(args, ['b', false, false]); return result; } };
  assert.equal(await loadBiSMemberResult(screen, 'b'), result); assert.equal(calls, 1);
});

test('a stale or removed partner result cannot enter a comparison', async () => {
  const state = { revision: 7, members: [{ id: 'b' }] };
  const screen = { state, async ensureDuoDetails() { state.revision++; return { memberId: 'b', stateRevision: 7, currentBiS: {} }; } };
  await assert.rejects(loadBiSMemberResult(screen, 'b'), /saved gear changed/);
  screen.sandbox = { active: true }; await assert.rejects(loadBiSMemberResult(screen, 'b'), /Exit Sandbox/);
});

test('the equipment recorder only submits a selected known item and blocks a stale review', async () => {
  const el = (tag, text) => ({ tag, textContent: text, value: '', children: [], events: {}, append(...nodes) { this.children.push(...nodes); }, replaceChildren(...nodes) { this.children = nodes; }, setAttribute() {}, addEventListener(name, fn) { this.events[name] = fn; } });
  const attempts = [], member = { id: 'a', obtainedEquipment: [] }; let current = true, refreshed = 0;
  const context = { el, state: () => ({ members: [member] }), definitions: () => ({ equipment: { 'Rune pickaxe': {} } }), button(label, fn) { const node = el('button', label); node.events.click = fn; return node; }, async command(payload, revision) { attempts.push({ payload, revision }); } };
  const node = createEquipmentRecorder(context, { memberId: 'a', revision: 7, assertCurrent() { if (!current) throw Error('stale'); }, onSaved() { refreshed++; } });
  const search = node.children.find(row => row.tag === 'input'), choices = node.children.at(-1);
  search.value = 'unknown'; search.events.input(); assert.equal(choices.children.length, 0); assert.equal(attempts.length, 0);
  search.value = 'pick'; search.events.input(); await choices.children[0].events.click();
  assert.deepEqual(attempts, [{ payload: { type: 'set-obtained-equipment', memberId: 'a', equipmentName: 'Rune pickaxe', obtained: true }, revision: 7 }]); assert.equal(refreshed, 1);
  current = false; await assert.rejects(choices.children[0].events.click(), /stale/); assert.equal(attempts.length, 1);
});
