import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuleExplanations, appendRuleExplanation, explanationLimits } from '../app/web/rule-explanations.mjs';
import { rulesCatalogue, ruleExplanations, buildRulesSections, filterRulesSections } from '../app/web/rules-model.mjs';
import { builtInRules } from '../app/core/rules.mjs';
import { datasetJSON } from '../app/dataset-runtime.mjs';
import { visibleRulesSections } from '../app/web/kept-rules.mjs';
import { UNKNOWN_DROP_RULE } from '../app/data/settings.mjs';
import { FUTURE_SLAYER_UNLOCKS_RULE } from '../app/data/slayer-unlock-gates.mjs';

const entry = () => ({ what: 'Shows a listed task when its requirements are met.', example: 'Turning this off hides the example task.',
  sources: [{ title: 'Synthetic source', url: 'https://runescape.wiki/w/Example?oldid=1' }] });
const raw = () => ({ schemaVersion: 1, entries: { sample: entry() } });

test('explanations require each short part, safe pinned Wiki credits and exact coverage', () => {
  assert.ok(Object.isFrozen(loadRuleExplanations(raw(), ['sample']).sample));
  for (const part of ['what', 'example']) {
    const missing = raw(); delete missing.entries.sample[part]; assert.throws(() => loadRuleExplanations(missing));
  }
  for (const [part, limit] of Object.entries(explanationLimits)) {
    const long = raw(); long.entries.sample[part] = 'x'.repeat(limit + 1); assert.throws(() => loadRuleExplanations(long));
  }
  const verbose = raw(); verbose.entries.sample.what = 'First sentence. Second sentence. Third sentence.';
  assert.throws(() => loadRuleExplanations(verbose));
  for (const text of ['Use tasks.private-rule.', ['rs3', 'task', 'example'].join(':'), 'Use 12345-0.', '<b>Text</b>', 'Two\nparts']) {
    const bad = raw(); bad.entries.sample.what = text; assert.throws(() => loadRuleExplanations(bad));
  }
  for (const url of ['https://runescape.wiki/w/Example', 'https://example.com/w/Page?oldid=1', 'javascript:alert(1)', 'https://runescape.wiki/w/Example?oldid=0', 'https://runescape.wiki/w/Example?oldid=1&extra=bad']) {
    const bad = raw(); bad.entries.sample.sources[0].url = url; assert.throws(() => loadRuleExplanations(bad));
  }
  assert.throws(() => loadRuleExplanations(raw(), ['missing']));
  assert.throws(() => loadRuleExplanations(raw(), ['sample', 'missing']));
});

test('selected explanation catalogue covers normal, Advanced and saved compatibility rules', async t => {
  if (!rulesCatalogue.explanationsFile) { t.skip('This dataset has no separate explanation catalogue.'); return; }
  const data = await datasetJSON(rulesCatalogue.explanationsFile);
  const state = { members: [{ id: 'one', taskRules: Object.fromEntries(data.savedRuleIds.map(id => [id, false])) }] };
  const sections = buildRulesSections(rulesCatalogue, state, builtInRules);
  const all = sections.flatMap(section => section.rules);
  const authored = all.filter(rule => !Object.hasOwn(data.entries, rule.id));
  assert.deepEqual(authored.map(rule => rule.id), [UNKNOWN_DROP_RULE, FUTURE_SLAYER_UNLOCKS_RULE]);
  loadRuleExplanations(structuredClone(data), all.filter(rule => !authored.includes(rule)).map(rule => rule.id));
  loadRuleExplanations({ schemaVersion: 1, entries: structuredClone(ruleExplanations) }, all.map(rule => rule.id));
  assert.equal(all.length, data.coverage.total + 2);
  assert.equal(visibleRulesSections(sections).flatMap(section => section.rules).length, data.coverage.normal + 2);
  assert.ok(all.every(rule => rule.explanation === ruleExplanations[rule.id]));
  for (const rule of all) {
    const prose = [rule.explanation.what, rule.explanation.example, rule.explanation.grindWarning ?? ''].join(' ');
    for (const candidate of all.filter(row => /[a-z][A-Z]|\.|:/.test(row.id))) {
      assert.equal(prose.includes(candidate.id), false, `Storage name in ${rule.id}`);
    }
  }
});

function harness() {
  class Node {
    constructor(tag, text = '', className) { Object.assign(this, { tag, textContent: text, className, children: [] }); }
    append(...children) { this.children.push(...children); }
  }
  const el = (...args) => new Node(...args);
  return { host: el('div'), ctx: { el, details: (label, ...children) => { const node = el('details', label); node.append(...children); return node; } } };
}

test('visible decision text has a folded example, optional warning and safe source links', () => {
  const h = harness(), explanation = { ...entry(), grindWarning: 'This example can take a long time.' };
  assert.equal(appendRuleExplanation(h.ctx, h.host, { explanation }), true);
  assert.equal(h.host.children[0].textContent, `What it does: ${explanation.what}`);
  const extra = h.host.children[1];
  assert.equal(extra.tag, 'details'); assert.equal(extra.open, undefined);
  assert.equal(extra.textContent, 'Example & grind warning');
  assert.equal(extra.children[0].textContent, `Example: ${explanation.example}`);
  assert.equal(extra.children[1].textContent, `Grind warning: ${explanation.grindWarning}`);
  const link = extra.children[2].children[0];
  assert.equal(link.href, explanation.sources[0].url); assert.equal(link.rel, 'noopener noreferrer');
  const noWarning = harness(); appendRuleExplanation(noWarning.ctx, noWarning.host, { explanation: entry() });
  assert.equal(noWarning.host.children[1].textContent, 'Example');
  assert.equal(noWarning.host.children[1].children.length, 2);
  assert.equal(appendRuleExplanation(h.ctx, h.host, {}), false);
});

test('rule search includes the explanation and example', () => {
  const sections = [{ id: 'one', name: 'Section', rules: [{ id: 'sample', label: 'Sample', explanation: { ...entry(), example: 'A searchable concrete example.' } }] }];
  assert.equal(filterRulesSections(sections, new Map(), { query: 'concrete' })[0].rules[0].id, 'sample');
  const saved = buildRulesSections(rulesCatalogue, { members: [{ taskRules: { constructor: false } }] }, builtInRules);
  const older = saved.flatMap(section => section.rules).find(rule => rule.id === 'constructor');
  assert.equal(older.explanation, undefined);
  const h = harness(); assert.equal(appendRuleExplanation(h.ctx, h.host, older), false);
});
