import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const folder = new URL('../app/web/placeholder-art/', import.meta.url);
const skills = 'agility archaeology attack constitution construction cooking crafting defence divination dungeoneering farming firemaking fishing fletching herblore hunter invention magic mining necromancy prayer ranged runecrafting slayer smithing strength summoning thieving woodcutting'.split(' ');
const tasks = ['quest', 'achievements', 'minigame', 'clue', 'music'];
const pins = ['general', 'transport', 'skilling', 'combat-slayer', 'quests-achievements', 'minigames', 'other'];
const icons = [...skills.map(name => `skill-${name}.svg`), ...tasks.map(name => `task-${name}.svg`), ...pins.map(name => `pin-${name}.svg`), 'item.svg'].sort();
const payloads = [...icons, 'README.md', '.gitattributes'].sort();
const author = 'drawn by hand-written SVG for this project, no reference images';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

// Title is the required inert metadata exception to the geometry-only subset.
const geometry = {
  svg: ['xmlns', 'viewBox'], g: [], title: [], path: ['d'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry'], circle: ['cx', 'cy', 'r'],
  ellipse: ['cx', 'cy', 'rx', 'ry'], line: ['x1', 'y1', 'x2', 'y2'],
  polyline: ['points'], polygon: ['points'],
};
const presentation = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin'];
const number = /^(?:\d+(?:\.\d+)?|\.\d+)$/;

function validateSvg(bytes) {
  assert.ok(bytes.length < 2048, 'SVG must be below 2 KB');
  const svg = bytes.toString('utf8');
  assert.equal(Buffer.from(svg).compare(bytes), 0, 'SVG must be valid UTF-8');
  assert.ok(!/[&]|<!|<\?/.test(svg), 'No entities, declarations or processing instructions');
  const tokens = svg.match(/<[^>]*>|[^<]+/g) ?? [];
  assert.equal(tokens.join(''), svg, 'No unparsed markup');
  const stack = [];
  const paints = [];
  const drawings = [];
  let roots = 0, titles = 0, shapes = 0, titleText = '';
  for (const token of tokens) {
    if (!token.startsWith('<')) {
      if (stack.at(-1) === 'title') titleText += token;
      else assert.ok(!token.trim(), 'Only title may contain text');
      continue;
    }
    const closing = /^<\/([a-z]+)>$/.exec(token);
    if (closing) {
      assert.equal(stack.pop(), closing[1], 'Elements must close in order');
      paints.pop();
      continue;
    }
    const tag = /^<([a-z]+)((?:\s[^<>]*?)?)\s*(\/?)>$/.exec(token);
    assert.ok(tag, 'Malformed tag');
    const [, name, raw, selfClosing] = tag;
    assert.ok(Object.hasOwn(geometry, name), `Disallowed element: ${name}`);
    if (name === 'svg') {
      assert.equal(stack.length, 0, 'No nested SVG');
      assert.equal(++roots, 1, 'One root');
      assert.ok(!selfClosing, 'Root must contain drawing');
    } else {
      assert.ok(stack.length, 'Elements must be inside root');
      assert.ok(['svg', 'g'].includes(stack.at(-1)), 'Only svg and g may contain elements');
      if (name === 'title') {
        assert.equal(stack.at(-1), 'svg', 'Title belongs to root');
        assert.ok(!selfClosing, 'Title must contain text');
        titles++;
      } else if (name !== 'g') shapes++;
    }
    const allowed = new Set([...geometry[name], ...(name === 'title' ? [] : presentation)]);
    const attrs = new Map();
    let rest = raw;
    while (rest.trim()) {
      const attr = /^\s+([A-Za-z][\w:-]*)=(?:"([^"<>]*)"|'([^'<>]*)')/.exec(rest);
      assert.ok(attr, 'Malformed or unquoted attribute');
      const key = attr[1], value = attr[2] ?? attr[3];
      assert.ok(allowed.has(key), `Disallowed attribute: ${key}`);
      assert.ok(!attrs.has(key), 'No duplicate attributes');
      attrs.set(key, value);
      rest = rest.slice(attr[0].length);
      if (key === 'xmlns') assert.equal(value, 'http://www.w3.org/2000/svg');
      else if (key === 'viewBox') assert.equal(value, '0 0 24 24');
      else if (key === 'fill' || key === 'stroke') assert.match(value, /^(?:none|#[0-9a-f]{6})$/, 'Only flat colours');
      else if (key === 'stroke-linecap') assert.ok(['round', 'butt', 'square'].includes(value));
      else if (key === 'stroke-linejoin') assert.ok(['round', 'miter', 'bevel'].includes(value));
      else if (key === 'd') assert.match(value, /^[MmZzLlHhVvCcSsQqTtAa0-9eE+.,\s-]+$/, 'Only path commands and numbers');
      else if (key === 'points') assert.match(value, /^[0-9+.,\s-]+$/);
      else assert.match(value, number, 'Only unsigned numeric geometry or stroke size');
    }
    if (name === 'svg') {
      assert.equal(attrs.get('xmlns'), 'http://www.w3.org/2000/svg');
      assert.equal(attrs.get('viewBox'), '0 0 24 24');
    }
    const paint = { ...paints.at(-1), ...Object.fromEntries([...attrs].filter(([key]) => presentation.includes(key))) };
    if (!['svg', 'g', 'title'].includes(name)) {
      drawings.push({ name, geometry: Object.fromEntries([...attrs].filter(([key]) => geometry[name].includes(key))), paint });
    }
    if (!selfClosing) { stack.push(name); paints.push(paint); }
  }
  assert.equal(stack.length, 0, 'All tags must close');
  assert.equal(roots, 1);
  assert.equal(titles, 1, 'Exactly one title');
  assert.ok(titleText.trim(), 'Title must be nonempty');
  assert.ok(shapes > 0, 'Must contain geometry');
  return drawings;
}

function validateStickerEdge(drawings) {
  const firstArt = drawings.findIndex(shape => shape.paint.stroke !== '#f4efe4');
  assert.ok(firstArt > 0, 'Light rim must precede the artwork');
  const rims = drawings.slice(0, firstArt);
  const artwork = drawings.slice(firstArt);
  assert.ok(artwork.length > 0, 'Rim must have artwork above it');
  assert.ok(artwork.some(shape => shape.paint.stroke === '#25313b'), 'Keep the dark inner outline');
  for (const shape of artwork) {
    const rim = rims.find(candidate => candidate.name === shape.name
      && JSON.stringify(candidate.geometry) === JSON.stringify(shape.geometry)
      && Number(candidate.paint['stroke-width']) - Number(shape.paint['stroke-width']) >= 2
      && Number(candidate.paint['stroke-width']) - Number(shape.paint['stroke-width']) <= 3);
    assert.ok(rim, 'Every artwork outline needs matching wider light geometry underneath');
  }
  for (const rim of rims) {
    assert.equal(rim.paint.fill, 'none', 'Rim must not fill gaps in the doodle');
    assert.equal(rim.paint['stroke-linecap'], 'round');
    assert.equal(rim.paint['stroke-linejoin'], 'round');
  }
}

test('all 42 expected placeholder drawings and their documentation exist', async () => {
  assert.equal(icons.length, 42);
  assert.deepEqual((await readdir(folder)).sort(), [...payloads, 'provenance.json'].sort());
});

test('every placeholder is small, titled and uses only inert SVG geometry', async () => {
  for (const file of icons) {
    try { validateSvg(await readFile(new URL(file, folder))); }
    catch (error) { throw new Error(`${file}: ${error.message}`, { cause: error }); }
  }
});

test('every placeholder has a wider light sticker edge beneath the same artwork', async () => {
  for (const file of icons) {
    try { validateStickerEdge(validateSvg(await readFile(new URL(file, folder)))); }
    catch (error) { throw new Error(`${file}: ${error.message}`, { cause: error }); }
  }
});

test('sticker checks reject missing, misplaced, narrow and mismatched rims', async () => {
  const valid = await readFile(new URL('skill-agility.svg', folder), 'utf8');
  validateStickerEdge(validateSvg(Buffer.from(valid)));
  const invalid = [
    valid.replace(/  <g [^>]+>[\s\S]*?<\/g>\n/, ''),
    valid.replace('#f4efe4', '#25313b'),
    valid.replace('stroke-width="6.8"', 'stroke-width="4.2"'),
    valid.replace('cx="14"', 'cx="13"'),
    valid.replace('fill="none"', 'fill="#f4efe4"'),
    valid.replace('stroke-linejoin="round"', 'stroke-linejoin="miter"'),
    valid.replace('stroke-linecap="round"', 'stroke-linecap="butt"'),
  ];
  for (const svg of invalid) assert.throws(() => validateStickerEdge(validateSvg(Buffer.from(svg))));
});

test('provenance covers every payload with matching byte hashes and authorship', async () => {
  const manifest = JSON.parse(await readFile(new URL('provenance.json', folder), 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(manifest.files.map(entry => entry.file).sort(), payloads);
  for (const entry of manifest.files) {
    assert.equal(entry.author, author);
    assert.equal(entry.date, '2026-10-13');
    assert.equal(entry.license, 'MIT');
    assert.match(entry.sha256, /^[0-9a-f]{64}$/);
    assert.equal(entry.sha256, hash(await readFile(new URL(entry.file, folder))), `${entry.file} hash`);
  }
});

test('the SVG validator rejects active content, references and malformed markup', () => {
  const valid = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><title>Test</title><path d="M2 2 20 20" stroke="#25313b"/></svg>';
  validateSvg(Buffer.from(valid));
  const invalid = [
    ...['style', 'script', 'image', 'use', 'foreignObject', 'text', 'filter', 'animate'].map(name => valid.replace('<path', `<${name}`)),
    ...['href', 'xlink:href', 'onload', 'style', 'filter', 'class', 'font-family', 'xmlns:xlink'].map(name => valid.replace('d="', `${name}="bad" d="`)),
    valid.replace('#25313b', 'url(https://example.invalid/paint)'),
    valid.replace('0 0 24 24', '0 0 48 48'),
    valid.replace('Test', '&external;'),
    '<!DOCTYPE svg>' + valid,
    '<?xml version="1.0"?>' + valid,
    valid.replace('<title>Test</title>', ''),
    valid.replace('<title>Test</title>', '<title/>'),
    valid.replace('Test', ''),
    valid.replace('Test', '   '),
    valid.replace('Test', 'Test<g/>'),
    valid.replace('</svg>', '</g>'),
    valid.replace('<path', '<path href=bad'),
    valid.replace('<path', '<path stroke="#fff0cc"'),
    valid.replace('</svg>', '</svg><'),
    valid.replace('</svg>', '</svg><g/>'),
    valid + valid,
    valid.replace('</svg>', 'x'.repeat(2048) + '</svg>'),
  ];
  for (const svg of invalid) assert.throws(() => validateSvg(Buffer.from(svg)), svg.slice(0, 120));
});

test('hashed SVG line endings are pinned on checkout', async () => {
  assert.equal(await readFile(new URL('.gitattributes', folder), 'utf8'), '*.svg text eol=lf\n');
});
