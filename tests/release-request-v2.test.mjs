// Focused request intake only: no application imports, gates, servers or live inputs.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkRequest } from '../scripts/private-companion/release-v2.mjs';
import { stageReleaseKit } from '../scripts/private-companion/stage-release-v2.mjs';
import { validateReleaseTextInput, applyTextEntries, copyPreviousTextSource } from '../scripts/private-companion/release-text.mjs';
import { hashTree } from '../scripts/private-companion/release-identity.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const scripts = fileURLToPath(new URL('../scripts/private-companion/', import.meta.url));
const put = async (file, value) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, typeof value === 'string' ? value : JSON.stringify(value)); };
const request = () => ({ releaseId: 'fixture-r18', changelog: { date: '2026-10-18', title: 'Fixture update', items: ['Fixture entry.'] }, roadmap: { id: 'A1', note: 'Changed fixture note.' } });
async function fixture(t) {
  const root = await mkdtemp(path.join(process.env.RS3_STAGEFIX_TEST_ROOT ?? os.tmpdir(), 'request-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const kit = path.join(root, 'accepted'), addon = path.join(root, 'previous/addon.json');
  const data = [
    ['changelog.json', { schemaVersion: 1, entries: [{ date: '2026-10-17', title: 'Previous fixture', items: ['Earlier.'] }] }],
    ['roadmap.json', { schemaVersion: 1, updated: '2026-10-17', themes: [{ items: [{ id: 'A1', note: 'Earlier fixture note.' }] }] }],
  ];
  const files = [];
  for (const [name, value] of data) { const bytes = JSON.stringify(value); await put(path.join(path.dirname(addon), 'app/data', name), bytes); files.push({ path: 'app/data/' + name, sha256: sha(bytes) }); }
  const addonBytes = JSON.stringify({ files }); await put(addon, addonBytes);
  const config = path.join(root, 'previous/config.json'), configBytes = JSON.stringify({ addons: { path: addon, sha256: sha(addonBytes) } });
  await put(config, configBytes);
  const current = path.join(root, 'current.json'); await put(current, { schemaVersion: 2, releaseId: 'fixture-r17', config: { path: config, sha256: sha(configBytes) } });
  const input = path.join(root, 'request.json'); await put(input, request());
  // Deliberately unrelated source text: inspection must use the pointer's pinned addon.
  await put(path.join(kit, 'checks/private-source/app/data/roadmap.json'), { deliberatelyWrong: true });
  await put(path.join(kit, 'packs/selection.json'), { version: 'old' });
  await put(path.join(kit, 'release-gate/corpus/fixture.txt'), 'Fixture corpus');
  await put(path.join(kit, 'tools/gallery-browser-check.mjs'), '// Fixture');
  // The CLI resolves the kit's retry policy from kit.json; empty keeps the default.
  await put(path.join(kit, 'kit.json'), {});
  const source = path.join(root, 'source');
  await put(path.join(source, 'scripts/private-companion/release-v2.mjs'), '// Fixture');
  await put(path.join(source, 'scripts/private-companion/requests/request.json'), {});
  const packs = path.join(root, 'new-packs'); await put(path.join(packs, 'selection.json'), { data: { version: '1.0.7' } });
  const wrapper = path.join(root, 'wrapper.ps1'); await put(wrapper, '# Never executed');
  return { root, kit, input, current, addon, config, stage: { source, accepted: kit, packs, heavyLock: wrapper, lightLock: wrapper, concurrency: 1 } };
}
function cli(file, args, temp) {
  try { return { code: 0, output: execFileSync(process.execPath, [path.join(scripts, file), ...args], { encoding: 'utf8', windowsHide: true, env: { ...process.env, TEMP: temp, TMP: temp }, stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (error) { return { code: error.status, output: String(error.stdout) + String(error.stderr) }; }
}

test('request dry run rejects unchanged note, accepts changed note and rejects bad date without changing inputs', async t => {
  const f = await fixture(t);
  for (const [mutation, rule] of [
    [value => { value.roadmap.note = 'Earlier fixture note.'; }, 'roadmap-note-unchanged'],
    [() => {}, null],
    [value => { value.changelog.date = '2026-02-30'; }, 'invalid-date'],
    [value => { value.changelog.date = '2026-10-16'; }, 'release-date-before-previous-text'],
    [value => { value.changelog.date = '2026-10-17'; value.changelog.title = 'Previous fixture'; }, 'duplicate-changelog-entry'],
    [value => { value.roadmap.id = 'Missing'; }, 'roadmap-item-missing'],
  ]) {
    const value = request(); mutation(value); await put(f.input, value);
    const before = (await hashTree(f.root)).digest;
    if (rule) await assert.rejects(checkRequest(f), error => error.releaseTextRule === rule && !error.message.includes(value.roadmap.note));
    else assert.equal((await checkRequest(f)).readOnly, true);
    assert.equal((await hashTree(f.root)).digest, before);
  }
  const unchanged = request(); unchanged.roadmap.note = 'Earlier fixture note.';
  assert.doesNotThrow(() => validateReleaseTextInput({ changelog: unchanged.changelog, roadmap: unchanged.roadmap }));
  const scratch = path.join(f.root, 'prepare-text-source');
  await copyPreviousTextSource(scratch, JSON.parse(await readFile(f.config)));
  await assert.rejects(applyTextEntries(scratch, { changelog: unchanged.changelog, roadmap: unchanged.roadmap }), /roadmap-note-unchanged/);
});

test('check-request CLI reports fixed rules without private prose or retained scratch', async t => {
  const f = await fixture(t), temp = path.join(f.root, 'temp'); await mkdir(temp);
  for (const [mutation, rule] of [[() => {}, null], [v => { v.roadmap.note = 'Earlier fixture note.'; }, 'roadmap-note-unchanged'], [v => { v.changelog.date = '2026-02-30'; }, 'invalid-date']]) {
    const value = request(); mutation(value); await put(f.input, value);
    const before = (await hashTree(f.root)).digest;
    const result = cli('release-v2.mjs', ['check-request', '--kit', f.kit, '--input', f.input, '--current', f.current], temp);
    assert.equal(result.code, rule ? 1 : 0, result.output);
    if (rule) assert.ok(result.output.includes(rule));
    assert.ok(!result.output.includes(value.roadmap.note)); assert.ok(!result.output.includes(value.changelog.title));
    assert.deepEqual(await readdir(temp), []); assert.equal((await hashTree(f.root)).digest, before);
  }
  await writeFile(f.input, '{private malformed fixture');
  const invalid = cli('release-v2.mjs', ['check-request', '--kit', f.kit, '--input', f.input, '--current', f.current], temp);
  assert.equal(invalid.code, 1); assert.match(invalid.output, /request-json/); assert.ok(!invalid.output.includes('private malformed fixture'));
});

test('staging request check happens before any kit or export and optional requests preserve legacy staging', async t => {
  const f = await fixture(t), temp = path.join(f.root, 'temp'); await mkdir(temp);
  for (const [mutation, rule] of [[v => { v.roadmap.note = 'Earlier fixture note.'; }, 'roadmap-note-unchanged'], [v => { v.changelog.date = '2026-02-30'; }, 'invalid-date']]) {
    const value = request(); mutation(value); await put(f.input, value);
    const before = (await hashTree(f.root)).digest;
    const result = cli('stage-release-v2.mjs', ['--source', f.stage.source, '--accepted', f.kit, '--packs', f.stage.packs, '--output', path.join(f.root, 'refused-kit'), '--request', f.input, '--current', f.current], temp);
    assert.equal(result.code, 1); assert.match(result.output, new RegExp(rule)); assert.ok(!result.output.includes(value.roadmap.note));
    assert.equal((await hashTree(f.root)).digest, before);
  }
  await put(f.input, request());
  await stageReleaseKit({ ...f.stage, output: path.join(f.root, 'new-kit'), request: f.input, current: f.current });
  await stageReleaseKit({ ...f.stage, output: path.join(f.root, 'legacy-kit') });
  await assert.rejects(stageReleaseKit({ ...f.stage, output: path.join(f.root, 'missing-current'), request: f.input }), /request-source/);
});

test('previous addon and prose pins are enforced by the shared prepare/check copier', async t => {
  const f = await fixture(t);
  await writeFile(path.join(path.dirname(f.addon), 'app/data/roadmap.json'), '{}');
  await assert.rejects(checkRequest(f), error => error.releaseTextRule === 'previous-prose-pin');
  await writeFile(f.addon, '{}');
  await assert.rejects(checkRequest(f), error => error.releaseTextRule === 'previous-addon-pin');
});
