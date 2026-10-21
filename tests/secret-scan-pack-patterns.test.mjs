import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectPackPaths, hasPackHomePath } from '../scripts/secret-scan/pack-patterns.mjs';

const drive = String.fromCharCode(67, 58);
const slash = String.fromCharCode(92);
const windows = (account, separator = '/') => [drive, 'Users', account, 'source.json'].join(separator);
const posix = (root, account) => '/' + [root, account, 'source.json'].join('/');
const encoded = text => [...text].map(char => '%' + char.charCodeAt(0).toString(16).padStart(2, '0')).join('');
const unicode = text => [...text].map(char => slash + 'u' + char.charCodeAt(0).toString(16).padStart(4, '0')).join('');

test('pack provenance rejects all home accounts, including generic names', () => {
  for (const account of ['User', 'runner', 'runneradmin', 'Public', 'Default', 'synthetic-account']) {
    for (const value of [windows(account), windows(account, slash), windows(account, slash.repeat(2)), posix('home', account), posix('Users', account)]) {
      const result = inspectPackPaths(JSON.stringify({ source: value }), { escaped: true });
      assert.deepEqual(result, [{ category: 'machine-path', line: 1, stable: true }]);
      assert.equal(hasPackHomePath(value), true);
      assert.deepEqual(Object.keys(result[0]).sort(), ['category', 'line', 'stable']);
    }
  }
  assert.equal(hasPackHomePath('%' + 'USERPROFILE' + '%'), true);
});

test('percent, Unicode and repeated backslash spellings remain blocked', () => {
  const value = windows('User', slash);
  for (const spelling of [encoded(value), encoded(encoded(value)), unicode(value), encoded(unicode(value)), unicode(encoded(value)), JSON.stringify(value)]) {
    assert.equal(hasPackHomePath(spelling), true);
    assert.equal(inspectPackPaths(spelling, { escaped: false })[0].stable, true);
  }
  const home = posix('home', 'runner');
  for (const path of [value, home]) assert.equal(hasPackHomePath('%FF' + encoded(path)), true);
  for (const spelling of ['file:' + '/'.repeat(2) + home, home.replaceAll('/', slash + '/')]) {
    assert.equal(hasPackHomePath(spelling), true);
    assert.equal(hasPackHomePath(encoded(spelling)), true);
  }
});

test('unrelated game paths and ordinary public URL routes remain clean', () => {
  for (const value of ['app/data/game.json', 'local-map/manifest.json', 'resources/Users/icon.png',
    'reference/home/map.png', 'https://example.invalid/home/player', 'https://example.invalid/Users/player',
    'https://runescape.wiki/w/Home', 'game-user-profile', '/game/regions/28', drive + '/game/cache/source.json']) {
    assert.deepEqual(inspectPackPaths(value), []);
    assert.equal(hasPackHomePath(value), false);
  }
});

test('findings retain raw source line numbers and deduplicate per source line', () => {
  const value = windows('User');
  assert.deepEqual(inspectPackPaths('heading\r\n' + JSON.stringify({ source: value, other: value }) + '\r\nend'),
    [{ category: 'machine-path', line: 2, stable: true }]);
  const introduced = 'heading\n' + 'prefix' + slash + 'u000a' + unicode(value) + '\nend';
  assert.deepEqual(inspectPackPaths(introduced), [{ category: 'machine-path', line: 2, stable: false }]);
  const percentBreak = 'heading\n' + encoded('\r\n' + value) + '\nend';
  assert.deepEqual(inspectPackPaths(percentBreak), [{ category: 'machine-path', line: 2, stable: false }]);
});
