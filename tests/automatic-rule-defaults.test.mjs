import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { taskRuleDefault, taskRuleEnabled, taskRuleBooleanDefaults } from '../app/tasks/rule-defaults.mjs';
import { taskRuleCutoffDefaults, taskRuleDefinitions, taskRuleBehavior, taskRuleCategoryCounts } from '../app/data/settings.mjs';
import { taskRuleAutomaticValue, taskRuleValue } from '../app/web/rules-model.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';

const fixtureMap = 'fixture-map';
const state = () => ({ taskRules: {}, members: [{ id: 'a', sourceMapId: fixtureMap, taskRules: {} }],
  legacy: { maps: { [fixtureMap]: { rules: {} } } } });

test('engine and presentation literal fallbacks agree with the automatic contract', async () => {
  const fallbackById = new Map();
  let calls = 0;
  for (const filename of ['engine.mjs', 'presentation.mjs']) {
    const source = await readFile(new URL(`../app/tasks/${filename}`, import.meta.url), 'utf8');
    // Account for every call, including dynamic category/unsupported gates, so
    // a new call shape cannot silently disappear from this consistency check.
    const matches = [...source.matchAll(/\b(?:on|enabled)\(rules,\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\w+)\s*(?:,\s*(true|false))?\s*\)/g)];
    assert.equal(matches.length, [...source.matchAll(/\b(?:on|enabled)\(rules,/g)].length, `${filename}: unrecognized rule call`);
    for (const [, token, explicitFallback] of matches) {
      calls++;
      const fallback = explicitFallback !== 'false';
      if (!/^['"]/.test(token)) {
        if (token === 'rule') {
          // Unsupported-rule diagnostics report explicit opt-ins; they do not
          // control gameplay and intentionally default off.
          assert.equal(explicitFallback, 'false');
          assert.match(source, /for \(const rule of UNSUPPORTED_RULES\) if \(on\(rules, rule, false\)\) diagnostics\.push/);
        } else {
          assert.equal(token, 'tag', `${filename}: unknown dynamic gate needs review`);
          assert.equal(explicitFallback, undefined, `${filename}: category gates must use each rule's contract default`);
        }
        continue;
      }
      const id = token.slice(1, -1);
      if (fallbackById.has(id)) assert.equal(fallback, fallbackById.get(id), `${id}: conflicting authored fallbacks`);
      fallbackById.set(id, fallback);
      assert.equal(taskRuleDefault(id), fallback, `${filename}: ${id} automatic value differs from unset behavior`);
      assert.equal(taskRuleEnabled({}, id), fallback, `${id}: runtime and presentation default differ`);
    }
    assert.match(source, /const (?:on|enabled) = taskRuleEnabled;/);
  }
  assert.ok(calls > 30, 'the consistency scan must exercise the actual rule call sites');
  assert.ok(fallbackById.size > 20, 'the automatic contract must cover the task rules');
});

test('every active selected rule has an authored automatic value', () => {
  for (const rule of taskRuleDefinitions) {
    if (['retained-only', 'not-implemented'].includes(taskRuleBehavior(rule.id).status)) continue;
    assert.notEqual(taskRuleDefault(rule.id), undefined, `${rule.id}: active rule has no automatic value`);
    if (taskRuleCategoryCounts[rule.id] && !Object.hasOwn(taskRuleBooleanDefaults, rule.id)) assert.equal(taskRuleDefault(rule.id), true, `${rule.id}: generic category gates are on when unset`);
  }
  assert.equal(taskRuleDefault('House storage tasks'), false);
  assert.equal(taskRuleDefault('PvM Relics'), true);
});

test('unset category gates match explicit canonical defaults in engine evaluation', () => {
  for (const id of ['Highest Level', 'Multi Step Processing', 'Farming Primary', 'Secondary Primary']) {
    const engine = createTaskEngine({ chunks: { '100': {} }, challenges: { Extra: {
      'Default gate fixture': { Category: [id], Primary: true, Output: 'Fixture output' },
    } } });
    const doc = { rules: {}, members: [{ id: 'a', unlocked: ['100'], completedTasks: [], taskRules: {} }] };
    const automatic = engine.evaluate(doc, 'a');
    doc.members[0].taskRules[id] = taskRuleDefault(id);
    const explicit = engine.evaluate(doc, 'a');
    for (const field of ['tasks', 'items', 'equipment', 'training']) assert.deepEqual(automatic[field], explicit[field], `${id}: unset ${field} differs from explicit default`);
  }
});

test('automatic values use authored defaults and preserve false rather than upstream metadata', () => {
  const doc = state();
  for (const [id, value] of [['Boosting', false], ['Non-permanent BiS', true], ['Cleaning Herbs', true], ['Shortcut Task', true], ['Kill X Amount', 1]]) {
    assert.deepEqual(taskRuleValue(doc, 'a', { id, default: !value }), { value, source: 'Automatic', explicit: false });
  }
  for (const [id, value] of Object.entries(taskRuleCutoffDefaults)) assert.equal(taskRuleDefault(id), value);
  for (const rule of taskRuleDefinitions.filter(rule => ['Mining', 'Fishing', 'Woodcutting', 'Extra', 'Quests', 'Achievement'].includes(rule.id))) assert.equal(taskRuleDefault(rule.id), true);
  assert.deepEqual(taskRuleValue(doc, 'a', { id: 'Retained fixture rule', type: 'boolean', default: true }), { value: undefined, source: 'Automatic', explicit: false });
});

test('personal reset preview resolves inherited and imported values without changing the save', () => {
  const doc = state(), definition = { id: 'Boosting' };
  doc.members[0].taskRules.Boosting = false;
  doc.legacy.maps[fixtureMap].rules.Boosting = true;
  let before = structuredClone(doc);
  assert.deepEqual(taskRuleValue(doc, 'a', definition), { value: false, source: 'Personal override', explicit: true });
  assert.deepEqual(taskRuleAutomaticValue(doc, 'a', definition), { value: true, source: 'Imported', explicit: false });
  assert.deepEqual(doc, before);
  doc.taskRules.Boosting = false;
  assert.deepEqual(taskRuleAutomaticValue(doc, 'a', definition), { value: false, source: 'Inherited', explicit: false });
  delete doc.taskRules.Boosting;
  doc.legacy.gameplayMigration = { schemaVersion: 2, migratedMembers: [{ memberId: 'a', sourceMapId: fixtureMap }] };
  before = structuredClone(doc);
  assert.deepEqual(taskRuleAutomaticValue(doc, 'a', definition), { value: false, source: 'Automatic', explicit: false });
  assert.deepEqual(doc, before);
  assert.throws(() => taskRuleAutomaticValue(doc, 'missing', definition), /Unknown rules player/);
});

test('runtime default helper preserves explicit and contextual gate behavior', () => {
  for (const value of [false, 'false', 0]) assert.equal(taskRuleEnabled({ Boosting: value }, 'Boosting'), false);
  for (const value of [true, 'true', 1, null]) assert.equal(taskRuleEnabled({ Boosting: value }, 'Boosting'), true);
  assert.equal(taskRuleEnabled({}, 'Boosting'), false);
  assert.equal(taskRuleEnabled({}, 'Boosting', true), true);
  assert.equal(taskRuleEnabled({}, 'Dynamic category', true), true);
  assert.equal(taskRuleEnabled({}, 'Unsupported fixture rule', false), false);
});
