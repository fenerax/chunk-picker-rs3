import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createContext, runInContext, Script } from 'node:vm';

// The assembly overlays the public helper. Its reference must therefore be
// captured separately from the exact public core being paired with this tree.
// Never silently compare the private helper with itself or a fixed name list.
async function noLinks(filename) {
  const absolute = path.resolve(filename), volume = path.parse(absolute).root;
  let current = volume;
  for (const component of absolute.slice(volume.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    assert.equal((await lstat(current)).isSymbolicLink(), false, `Input link refused: ${current}`);
  }
  const resolved = await realpath(absolute);
  assert.equal(resolved.toLowerCase(), absolute.toLowerCase(), 'Input canonical path differs');
  return resolved;
}

// Only a private overlay paired with a separate public tree has two harnesses to compare;
// the single public repository skips, visibly, unless a paired harness is named.
test('private browser harness supplies every public collaborator', { skip: !process.env.RS3_PUBLIC_BROWSER_SCREEN_HARNESS && 'no paired public harness (single repository)' }, async () => {
  const privatePath = await noLinks(fileURLToPath(new URL('./browser-screen-harness.mjs', import.meta.url)));
  const publicPath = await noLinks(path.resolve(process.env.RS3_PUBLIC_BROWSER_SCREEN_HARNESS));
  assert.notEqual(publicPath.toLowerCase(), privatePath.toLowerCase(), 'Public reference must be independent of the private overlay');
  const [privateStat, publicStat] = await Promise.all([lstat(privatePath), lstat(publicPath)]);
  assert.ok(!privateStat.ino || privateStat.ino !== publicStat.ino || privateStat.dev !== publicStat.dev,
    'Public reference must be independent of the private overlay (hardlink alias)');
  async function collaborators(helperPath) {
    const url = pathToFileURL(helperPath);
    let source = await readFile(url, 'utf8');
    const bindings = { URL };
    const imports = [...source.matchAll(/^import\s+(\{[^{};]*\}|\*\s+as\s+[\w$]+)\s+from\s+['"]([^'"]+)['"];?\r?\n/gm)];
    for (const [declaration, names, specifier] of imports) {
      const namespace = /^\*\s+as\s+(\w+)$/.exec(names.trim());
      if (namespace) {
        // Preserve spread-installed collaborators without importing app modules,
        // whose top-level dependencies can resolve the entire dataset.
        const dependency = await readFile(await noLinks(fileURLToPath(new URL(specifier, url))), 'utf8');
        const declarations = [...dependency.matchAll(/^\s*export\s+(?:(?:async\s+)?function|const|let|var|class)\s+([\w$]+)/gm)];
        assert.equal(declarations.length, [...dependency.matchAll(/^\s*export\b/gm)].length, 'Review unsupported namespace exports/re-exports');
        for (const declaration of dependency.matchAll(/^\s*export\s+(?:const|let|var)\b([^\r\n]*)/gm)) {
          assert.match(declaration[1], /;\s*$/, 'Review multiline namespace variable exports');
          assert.doesNotMatch(declaration[1], /,\s*[\w$]+\s*=/, 'Review multiple namespace variable exports');
        }
        const exports = declarations.map(match => match[1]);
        assert.ok(exports.length, `No namespace exports found: ${specifier}`);
        bindings[namespace[1]] = Object.fromEntries(exports.map(name => [name, () => {}]));
      } else {
        assert.match(names.trim(), /^\{[\s\S]*\}$/, `Review new helper import shape: ${names}`);
        const imported = specifier.startsWith('node:') ? await import(specifier) : null;
        for (const name of names.trim().slice(1, -1).split(',').map(value => value.trim()).filter(Boolean)) {
          const [original, local = original] = name.split(/\s+as\s+/);
          bindings[local] = imported ? imported[original] : () => {};
        }
      }
      source = source.replace(declaration, '');
    }
    source = source.replace(/\bimport\.meta\.url\b/g, JSON.stringify(url.href))
      .replace(/^export\s+(?=(?:async\s+)?function\s+|(?:const|let|class)\s+)/gm, '');
    const run = new Script(source + '\nrunScreenGraph;', { filename: helperPath }).runInNewContext(bindings, { timeout: 1000 });
    const context = createContext({});
    // Execute actual collaborator setup with stand-ins at the import boundary;
    // this checks names, presence and setup shape, not app collaborator behavior.
    const entry = new URL('../app/web/main.mjs', url);
    runInContext('run(context, modules)', createContext({ run, context, modules: new Map([[entry.href, 'const screen = {};\n']]) }), { timeout: 1000 });
    return context;
  }
  const [reference, actual] = await Promise.all([collaborators(publicPath), collaborators(privatePath)]);
  assert.equal(Object.getOwnPropertySymbols(reference).length, 0, 'Review symbol browser collaborators');
  const names = Object.getOwnPropertyNames(reference).sort();
  assert.ok(names.length, 'Public helper must install collaborators');
  const missing = names.filter(name => !Object.hasOwn(actual, name) || actual[name] == null);
  assert.deepEqual(missing, [], `Missing private browser collaborators: ${missing.join(', ')}`);
  const wrongTypes = names.filter(name => typeof actual[name] !== typeof reference[name]);
  assert.deepEqual(wrongTypes, [], `Private browser collaborator types differ: ${wrongTypes.join(', ')}`);
});
