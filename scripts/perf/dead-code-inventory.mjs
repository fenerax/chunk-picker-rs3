// Advisory lexical inventory, never a deletion list. No dependencies or app imports.
// Comments, data strings and test/VM references deliberately count as uses.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const self = path.relative(root, fileURLToPath(import.meta.url));
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const sources = new Map(files.filter(file => file !== self && /\.(?:m?js|html|json|ps1|ya?ml)$/.test(file))
  .map(file => [file, readFileSync(path.join(root, file), 'utf8')]));
const app = [...sources.keys()].filter(file => file.startsWith('app/') && /\.m?js$/.test(file));
const web = [...sources].filter(([file]) => file.startsWith('app/web/'));
const tests = [...sources].filter(([file]) => file.startsWith('tests/') && !file.startsWith('tests/fixtures/'));
const tokens = text => new Set(text.match(/[A-Za-z_$][\w$-]*/g) ?? []);
const otherTokens = new Map([...sources].map(([file, source]) => [file, tokens(source)]));
const corpus = web.map(([, source]) => source).join('\n');
const webTokens = new Set(corpus.match(/[A-Za-z_][\w-]*/g) ?? []);
const testCorpus = tests.map(([, source]) => source).join('\n');

// Resolve literal imports, re-exports, import(), Worker(new URL(...)), VM reads,
// HTML entry points and server allowlist strings. Basename matches intentionally
// over-retain modules if a name is ambiguous or lives in a route/data table.
const filenames = new Map();
for (const [file, source] of sources) for (const name of new Set(source.match(/[\w.-]+\.m?js\b/g) ?? [])) {
  if (!filenames.has(name)) filenames.set(name, new Set());
  filenames.get(name).add(file);
}
const references = file => [...(filenames.get(path.basename(file)) ?? [])].filter(other => other !== file);
const imported = new Set();
for (const [file, source] of sources) {
  for (const match of source.matchAll(/(?:\b(?:from|import)\s*|\bimport\s*\(\s*)['"]([^'"]+\.m?js)['"]/g)) {
    if (match[1].startsWith('.')) imported.add(path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1])));
  }
}
const entryModules = app.filter(file => !imported.has(file)).map(file => ({ file, references: references(file) }));
const dynamic = [];
for (const [file, source] of sources) {
  for (const match of source.matchAll(/\bimport\(\s*([^)]*)\)|\bnew Worker\(\s*([^,\n]*)/g)) {
    const expression = (match[1] ?? match[2]).trim();
    if (!/^(['"])[^'"]+\1$/.test(expression)) dynamic.push({ file, expression });
  }
}
const modules = app.filter(file => references(file).length === 0);
const exports = [];
for (const file of app) {
  const source = sources.get(file), names = new Set();
  for (const match of source.matchAll(/\bexport\s+(?:(?:async\s+)?function\s*\*?\s*|class\s+|(?:const|let|var)\s+)([\w$]+)/g)) names.add(match[1]);
  for (const match of source.matchAll(/\bexport\s*\{([^}]+)\}/g)) {
    for (const entry of match[1].split(',')) {
      const parts = entry.trim().split(/\s+as\s+/), name = parts.at(-1).trim();
      if (/^[\w$]+$/.test(name)) names.add(name);
    }
  }
  // The app also exports a flat object destructuring from its pipeline factory.
  for (const match of source.matchAll(/\bexport\s+(?:const|let|var)\s*\{([^}]+)\}\s*=/g)) {
    for (const entry of match[1].split(',')) {
      const name = entry.trim().split(':').at(-1).trim();
      if (/^[\w$]+$/.test(name)) names.add(name);
    }
  }
  if (/\bexport\s+default\b/.test(source)) names.add('default');
  for (const name of names) {
    if (name === 'default' ? references(file).length > 0 : [...otherTokens].some(([other, words]) => other !== file && words.has(name))) continue;
    exports.push({ file, name });
  }
}

// Read selector preludes, including inside @media/@supports. Only a missing
// class/id token is a candidate: element/attribute/pseudo-only selectors stay.
// Static chunks bordering ${...} are evidence for runtime-built names.
const chunks = [...corpus.matchAll(/([\w-]+)\$\{/g)].map(match => match[1]);
const css = [];
for (const file of files.filter(file => /^app\/web\/[^/]+\.css$/.test(file))) {
  const text = readFileSync(path.join(root, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of text.matchAll(/([^{}]+)\{/g)) {
    const prelude = match[1].trim();
    if (prelude.startsWith('@') || /^(?:from|to|[\d.% ,]+)$/.test(prelude)) continue;
    // Split only outside parentheses/brackets (e.g. :is(.a,.b)).
    const selectors = prelude.split(/,(?![^([\])]*[)\]])/);
    for (const selector of selectors) {
      const names = [...selector.matchAll(/[.#]([A-Za-z_][\w-]*)/g)].map(item => item[1]);
      const missing = names.filter(name => !webTokens.has(name));
      if (!missing.length) continue;
      css.push({ file, selector: selector.trim(), missing, keep: missing.some(name => chunks.some(chunk => name.startsWith(chunk)))
        ? 'runtime template prefix' : missing.some(name => testCorpus.includes(name)) ? 'test/VM reference' : 'manual producer review required' });
    }
  }
}

const fixtures = [];
for (const file of files.filter(file => file.startsWith('tests/fixtures/'))) {
  const relative = file.slice('tests/'.length), basename = path.basename(file), directory = path.posix.dirname(relative);
  const direct = tests.filter(([, source]) => source.includes(relative) || source.includes(basename)).map(([test]) => test);
  // Directory readers, interpolated filenames, helper modules and recursive
  // copies keep the whole subtree. Scripts may consume captured source fixtures.
  const indirect = [...sources].filter(([other, source]) => !other.startsWith('tests/fixtures/') && source.includes(`${directory}/`)).map(([other]) => other);
  fixtures.push({ file, readers: [...new Set([...direct, ...indirect])], keep: direct.length ? 'literal name/reference' : indirect.length ? 'directory/helper/data-driven reader; review manually' : 'no reader found; review manually' });
}

const result = { modules, entryModules, exports, css, fixtures, dynamic };
if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
else {
  console.log('# Conservative dead-code inventory\n');
  console.log('Lexical candidates only; inspect producers before deleting. Basename, comments, namespace/VM and data references over-retain deliberately. Export names are checked across source files, not just import clauses.\n');
  const section = (title, entries) => console.log(`## ${title} (${entries.length})\n\n${entries.length ? entries.map(entry => `- ${entry}`).join('\n') : 'None.'}\n`);
  section('App modules without a literal reference', modules.map(file => `\`${file}\` (unresolved dynamic entries below may still reach it)`));
  section('Modules without a literal relative import (entry points or unresolved)', entryModules.map(({ file, references }) => `\`${file}\`: keep; other filename references: ${references.join(', ') || 'none; review dynamic expressions'}`));
  section('Export names without a reference in another source file', exports.map(({ file, name }) => `\`${file}\`: \`${name}\``));
  section('CSS selectors with absent literal class/id tokens', css.map(({ file, selector, missing, keep }) => `\`${file}\`: \`${selector}\`; absent: ${missing.join(', ')}; ${keep}`));
  section('Fixture reader inventory', fixtures.map(({ file, readers, keep }) => `\`${file}\`: ${keep}${readers.length ? ` (${readers.join(', ')})` : ''}`));
  section('App dynamic import/worker expressions to retain or resolve manually', dynamic.filter(({ file }) => file.startsWith('app/')).map(({ file, expression }) => `\`${file}\`: \`\` ${expression} \`\``));
}
