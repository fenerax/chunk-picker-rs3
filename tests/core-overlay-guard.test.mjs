import test from 'node:test';
import assert from 'node:assert/strict';
import { coreOverlaySha256, reviewCoreOverlays, assertReviewedCoreOverlays } from '../scripts/private-companion/core-overlay-guard.mjs';

const name = 'tests/example.test.mjs', bytes = Buffer.from('test("core case", () => {});\n');
const inputs = manifest => ({ manifest, coreFiles: new Map([[name, bytes]]), privateFiles: new Set([name]) });
const reviewed = () => ({ schemaVersion: 1, files: { [name]: { coreSha256: coreOverlaySha256(bytes) } } });

test('identical copies still require explicit review; the message supplies the actual core hash', () => {
  const findings = reviewCoreOverlays(inputs(undefined));
  assert.equal(findings[0].id, 'overlay-unreviewed');
  assert.match(findings[0].fixHint, new RegExp(coreOverlaySha256(bytes)));
  assert.match(findings[0].fixHint, /\.private\.test\.mjs/);
  assert.throws(() => assertReviewedCoreOverlays(inputs(undefined)), /without review/);
  assert.deepEqual(reviewCoreOverlays(inputs(reviewed())), []);
});

test('a changed core invalidates prior review regardless of the private bytes', () => {
  const options = inputs(reviewed());
  options.coreFiles.set(name, Buffer.from('test("new core case", () => {});\n'));
  assert.equal(reviewCoreOverlays(options)[0].id, 'overlay-stale');
  assert.throws(() => assertReviewedCoreOverlays(options), /changed since its private replacement was reviewed/);
});

test('removed or renamed overlays invalidate unused manifest entries', () => {
  const options = inputs(reviewed()); options.privateFiles.clear();
  assert.equal(reviewCoreOverlays(options)[0].id, 'overlay-unused');
  assert.throws(() => assertReviewedCoreOverlays(options), /no longer replace a core file/);
});

test('CRLF and LF retain the established manifest hash convention', () => {
  const options = inputs(reviewed()); options.coreFiles.set(name, Buffer.from(bytes.toString().replaceAll('\n', '\r\n')));
  assert.deepEqual(reviewCoreOverlays(options), []);
});

test('malformed manifests fail closed instead of reviewing any replacement', () => {
  for (const manifest of [null, { schemaVersion: 2, files: {} }, { schemaVersion: 1, files: [] }]) {
    assert.equal(reviewCoreOverlays(inputs(manifest))[0].id, 'overlay-manifest-invalid');
  }
});

test('private-only cases need no manifest and helpers follow the same review rule', () => {
  assert.deepEqual(reviewCoreOverlays({ coreFiles: new Map(), privateFiles: new Set([name]) }), []);
  const helper = 'tests/browser-screen-harness.mjs';
  const result = reviewCoreOverlays({ coreFiles: new Map([[helper, bytes]]), privateFiles: new Set([helper]) });
  assert.equal(result[0].id, 'overlay-unreviewed');
  assert.equal(result[0].path, helper);
});
