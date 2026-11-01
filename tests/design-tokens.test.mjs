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

// Resolve the actual primary-action declarations independently of the theme
// contrast helper. These are opaque normal-text pairs, so the floor is 4.5:1.
const rule = (css, selector) => {
  const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(match => match[1].trim() === selector);
  assert.ok(blocks.length, `Missing CSS selector ${selector}`);
  return new Map(blocks.flatMap(match => [...match[2].matchAll(/([\w-]+):([^;{}]+)/g)]
    .map(value => [value[1], value[2].trim()])));
};
const relativeLuminance = hex => {
  assert.match(hex, /^#[\da-f]{6}$/i, 'contrast checks require an opaque hex colour');
  return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
};
for (const scheme of ['dark', 'light']) test(`${scheme} primary-action rest and hover retain normal-text contrast and a distinct fill`, () => {
  const css = sheet('style.css');
  // Remove comments before looking up exact selectors, including the root block.
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const tokens = rule(source, ':root');
  if (scheme === 'light') for (const selector of [':root[data-scheme=light]', ':root[data-theme=light]']) {
    for (const [key, value] of rule(source, selector)) tokens.set(key, value);
  }
  const resolve = value => {
    assert.ok(value, 'missing colour declaration');
    for (let depth = 0; value.startsWith('var(') && depth < 10; depth++) value = tokens.get(value.slice(4, -1));
    return value;
  };
  const resting = rule(source, '.primary-action'), hovering = new Map([...resting, ...rule(source, '.primary-action:hover')]);
  const restFill = resolve(resting.get('background')), hoverFill = resolve(hovering.get('background'));
  assert.notEqual(restFill, hoverFill, 'hover should visibly change the fill');
  assert.equal(hovering.get('filter'), 'none', 'generic hover brightening must not alter the pair');
  for (const [state, values] of [['rest', resting], ['hover', hovering]]) {
    const foreground = relativeLuminance(resolve(values.get('color'))), background = relativeLuminance(resolve(values.get('background')));
    const ratio = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    assert.ok(ratio >= 4.5, `${scheme} ${state}: ${ratio.toFixed(4)}:1 is below 4.5:1`);
  }
});
