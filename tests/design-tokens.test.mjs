import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const web = new URL('../app/web/', import.meta.url);
const sheet = name => readFileSync(new URL(name, web), 'utf8');
const declarations = css => new Map([...css.matchAll(/(--[\w-]+):([^;{}]+);/g)].map(match => [match[1], match[2]]));
const shared = declarations(sheet('style.css'));
const references = css => [...css.matchAll(/var\((--[\w-]+)/g)].map(match => match[1]);
const scaleReference = name => /^--(?:type-|space-|weight-|leading-|radius-|border-|shadow-|font-|color-)/.test(name);

test('every extracted scale reference resolves, including the independent OBS page', () => {
  for (const file of readdirSync(web).filter(file => file.endsWith('.css'))) {
    const css = sheet(file), available = file === 'overlay.css' ? declarations(css) : new Map([...shared, ...declarations(css)]);
    for (const name of references(css).filter(scaleReference)) assert.ok(available.has(name), `${file}: missing ${name}`);
    assert.doesNotMatch(css, /(?:^|[\s:])[-+]var\(/, `${file}: signed var() needs calc() or a signed token`);
    for (const name of available.keys()) {
      const visiting = new Set();
      const visit = key => {
        assert.ok(!visiting.has(key), `${file}: cyclic token ${key}`);
        visiting.add(key);
        for (const dependency of references(available.get(key) ?? '')) if (available.has(dependency)) visit(dependency);
        visiting.delete(key);
      };
      visit(name);
    }
  }
});

test('font registration retains a literal family name usable by the icon token', () => {
  const css = sheet('style.css');
  const registered = /@font-face\{font-family:([^;]+)/.exec(css)?.[1];
  assert.equal(registered, shared.get('--font-icons'));
  assert.doesNotMatch(registered, /var\(/);
  assert.equal(shared.get('--type-input-mobile'), '16px', 'phone search must retain its input zoom floor');
});

test('the documented exact-value registry matches the root definitions', () => {
  const registry = readFileSync(new URL('../docs/design-token-values.tsv', import.meta.url), 'utf8').trim().split('\n').slice(1);
  for (const row of registry) {
    const [name, value] = row.replace(/\r$/, '').split('\t');
    assert.equal(shared.get(name), value, `${name} needs its documented value updated`);
  }
});
