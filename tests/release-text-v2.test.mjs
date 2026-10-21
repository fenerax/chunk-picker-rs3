import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, writeFile, cp, rm, symlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateReleaseTextInput, applyTextEntries, verifyTextDelta, runTextEndpointCheck } from '../scripts/private-companion/release-text.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const input = () => ({ changelog: { date: '2026-10-16', title: 'Clearer update text', items: ['Read the latest notes.'] }, roadmap: { id: 'A1', note: 'The next review is ready.' } });
const beforeLog = { schemaVersion: 1, entries: [{ date: '2026-10-15', title: 'Earlier update', items: ['Earlier prose.'] }] };
const beforeMap = { schemaVersion: 1, updated: '2026-10-15', statuses: { next: 'Up next' }, sizes: { S: 'Small' },
  themes: [{ id: 'duo', title: 'Duo', blurb: 'Shared plans.', items: [{ id: 'A1', title: 'A plan', what: 'Review it.', why: 'Keep it clear.', status: 'next', size: 'S', note: 'Earlier note.' }] }] };
const payloads = ['app/data/changelog.json', 'app/data/roadmap.json', 'server/original-sync.mjs', 'app/web/gallery.mjs', 'app/web/original-sync.mjs',
  ...['gallery.html', 'gallery.css', 'gallery-catalogue.mjs', 'gallery-preview.mjs', 'gallery-capture.mjs', 'gallery-fixtures.mjs',
    'gallery-fixture-data.json', 'gallery-safety.mjs', 'gallery-usage.mjs', 'gallery-usage-fixture.mjs'].map(name => 'app/web/' + name)];
async function repin(root) {
  const manifest = { schemaVersion: 1, features: { projectUpdates: true, gallery: true,
    originalSync: { server: 'server/original-sync.mjs', browser: 'app/web/original-sync.mjs' } }, files: [] };
  for (const relative of payloads) manifest.files.push({ path: relative, sha256: sha(await readFile(path.join(root, relative))) });
  const bytes = JSON.stringify(manifest);
  await writeFile(path.join(root, 'addon.json'), bytes);
  return { path: path.join(root, 'addon.json'), sha256: sha(bytes) };
}
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'release-text-v2-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previous = path.join(root, 'previous'), candidate = path.join(root, 'candidate');
  for (const [relative, bytes] of [['app/data/changelog.json', JSON.stringify(beforeLog)], ['app/data/roadmap.json', JSON.stringify(beforeMap)],
    ['server/original-sync.mjs', 'export const unchanged = true;'], ['app/web/gallery.mjs', 'export const unchangedGallery = true;']]) {
    await mkdir(path.dirname(path.join(previous, relative)), { recursive: true }); await writeFile(path.join(previous, relative), bytes);
  }
  for (const relative of payloads.slice(4)) await writeFile(path.join(previous, relative), relative.endsWith('.json') ? '{}' : '/* unchanged fixture */');
  const previousAddon = await repin(previous);
  await cp(previous, candidate, { recursive: true });
  await applyTextEntries(candidate, input());
  const candidateAddon = await repin(candidate);
  const fixed = sha('fixed');
  return { root, previous, candidate, options: { previousAddon, candidateAddon, previousProfile: { digest: fixed }, candidateProfile: { digest: fixed },
    previousCoreDigest: fixed, candidateCoreDigest: fixed, previousInfrastructureDigest: fixed, candidateInfrastructureDigest: fixed,
    previousPacksDigest: fixed, candidatePacksDigest: fixed } };
}
async function edit(root, relative, mutation) {
  const filename = path.join(root, relative), value = JSON.parse(await readFile(filename, 'utf8'));
  mutation(value); await writeFile(filename, JSON.stringify(value));
}

test('text input accepts bounded plain prose and returns a detached value', () => {
  const value = input(), result = validateReleaseTextInput(value);
  value.changelog.items[0] = 'Changed';
  assert.equal(result.changelog.items[0], 'Read the latest notes.');
  assert.equal(validateReleaseTextInput({ ...input(), roadmap: { ...input().roadmap, date: '2026-10-16' } }).roadmap.date, '2026-10-16');
  assert.equal(validateReleaseTextInput({ ...input(), roadmap: { id: 'A1', note: 'Estimate: 1.5 minutes.' } }).roadmap.note, 'Estimate: 1.5 minutes.');
});

test('text input rejects keys, HTML, links, controls, invalid dates, and excess length', () => {
  const changes = [
    value => { value.extra = true; }, value => { value.changelog.extra = true; }, value => { value.roadmap.status = 'done'; },
    value => { value.changelog.title = '<b>Markup</b>'; }, value => { value.roadmap.note = 'See example.invalid/path'; },
    value => { value.roadmap.note = '[Open](javascript:run)'; }, value => { value.roadmap.note = 'See https://example.invalid'; },
    value => { value.changelog.items = ['Line\nbreak']; }, value => { value.changelog.title = 'Hidden\u202etext'; },
    value => { value.changelog.title = ' '; }, value => { value.changelog.title = 'x'.repeat(161); },
    value => { value.changelog.items = []; }, value => { value.changelog.items = Array(13).fill('Item'); },
    value => { value.changelog.items = ['x'.repeat(501)]; }, value => { value.roadmap.note = 'x'.repeat(1001); },
    value => { value.roadmap.id = '../A1'; }, value => { value.changelog.date = '2026-02-30'; },
    value => { value.roadmap.date = '2026-10-15'; }, value => { value.changelog.items = [null]; },
  ];
  for (const change of changes) { const value = input(); change(value); assert.throws(() => validateReleaseTextInput(value)); }
});

test('candidate update changes only the new entry, one note and updated date; original stays byte-identical', async t => {
  const { previous, candidate, options } = await fixture(t);
  assert.equal(await readFile(path.join(previous, payloads[0]), 'utf8'), JSON.stringify(beforeLog));
  assert.equal(await readFile(path.join(previous, payloads[1]), 'utf8'), JSON.stringify(beforeMap));
  const log = JSON.parse(await readFile(path.join(candidate, payloads[0]), 'utf8'));
  assert.deepEqual(log.entries, [input().changelog, ...beforeLog.entries]);
  const map = JSON.parse(await readFile(path.join(candidate, payloads[1]), 'utf8'));
  assert.equal(map.themes[0].items[0].note, input().roadmap.note);
  assert.equal(map.updated, input().changelog.date);
  const proof = await verifyTextDelta(options);
  assert.equal(proof.schema, 'rs3-text-proof-v2');
  assert.deepEqual(proof.changedPaths, payloads.slice(0, 2));
  assert.notEqual(proof.candidateAddonDigest, proof.previousAddonDigest);
});

test('stale, duplicate and unknown-item input fails before either candidate data file changes', async t => {
  const { candidate } = await fixture(t);
  const original = await Promise.all(payloads.slice(0, 2).map(name => readFile(path.join(candidate, name), 'utf8')));
  for (const change of [() => {}, value => { value.roadmap.id = 'Missing'; value.changelog.title = 'Another'; },
    value => { value.changelog.date = '2026-10-14'; value.changelog.title = 'Old'; }]) {
    const value = input(); change(value); await assert.rejects(applyTextEntries(candidate, value));
    assert.deepEqual(await Promise.all(payloads.slice(0, 2).map(name => readFile(path.join(candidate, name), 'utf8'))), original);
  }
});

test('every fixed component identity is mandatory and any drift forces full', async t => {
  const { options } = await fixture(t);
  for (const key of ['candidateCoreDigest', 'candidateInfrastructureDigest', 'candidatePacksDigest']) {
    await assert.rejects(verifyTextDelta({ ...options, [key]: sha('changed') }));
    const missing = { ...options }; delete missing[key]; await assert.rejects(verifyTextDelta(missing));
  }
  await assert.rejects(verifyTextDelta({ ...options, candidateProfile: { digest: sha('changed') } }));
  await assert.rejects(verifyTextDelta({ ...options, previousProfile: undefined }));
});

test('repinned executable, gallery, old history, roadmap structure and feature changes force full', async t => {
  for (const mutation of [
    async root => writeFile(path.join(root, payloads[2]), 'export const changed = true;'),
    async root => writeFile(path.join(root, payloads[3]), 'export const changedGallery = true;'),
    async root => edit(root, payloads[0], log => { log.entries[1].title = 'Rewritten history'; }),
    async root => edit(root, payloads[1], map => { map.themes[0].items[0].status = 'done'; }),
    async root => edit(root, payloads[1], map => { map.statuses.next = 'Changed'; }),
    async root => edit(root, payloads[1], map => { map.themes[0].title = 'Changed'; }),
    async root => edit(root, payloads[0], log => { log.entries[0].title = '<img>'; }),
  ]) {
    const { candidate, options } = await fixture(t); await mutation(candidate);
    options.candidateAddon = await repin(candidate); await assert.rejects(verifyTextDelta(options));
  }
  const { candidate, options } = await fixture(t);
  await edit(candidate, 'addon.json', manifest => { manifest.features.bankingInteriors = true; });
  options.candidateAddon = path.join(candidate, 'addon.json'); await assert.rejects(verifyTextDelta(options));
});

test('stale manifest pins, missing payloads, unlisted files and empty directories fail closed', async t => {
  for (const mutation of [
    async root => writeFile(path.join(root, payloads[0]), '{}'),
    async root => rm(path.join(root, payloads[1])),
    async root => writeFile(path.join(root, 'unlisted.mjs'), 'extra'),
    async root => mkdir(path.join(root, 'extra-empty-directory')),
    async root => writeFile(path.join(root, 'addon.json'), '{}'),
  ]) {
    const { candidate, options } = await fixture(t); await mutation(candidate); await assert.rejects(verifyTextDelta(options));
  }
  const { options } = await fixture(t);
  await assert.rejects(verifyTextDelta({ ...options, candidateAddon: { ...options.candidateAddon, sha256: sha('wrong') } }));
});

test('linked candidate payloads cannot borrow matching external bytes', async t => {
  const { root, candidate, options } = await fixture(t), filename = path.join(candidate, payloads[0]), target = path.join(root, 'external.json');
  await cp(filename, target); await rm(filename);
  try { await symlink(target, filename); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Host does not permit symlinks.'); return; } throw error; }
  await assert.rejects(verifyTextDelta(options));
});

test('endpoint gate refuses missing pins and escaped candidate paths before starting a server', async t => {
  const { root, candidate, options } = await fixture(t);
  const core = path.join(root, 'core');
  await assert.rejects(runTextEndpointCheck({ core, companion: candidate, receipt: { schemaVersion: 1, coreRoot: core, profile: {} } }));
  await assert.rejects(runTextEndpointCheck({ core, companion: candidate,
    receipt: { schemaVersion: 1, coreRoot: core, profile: options.previousAddon, addons: options.candidateAddon } }));
});
