// Execution/configuration and data inputs can change tests without import edges.
// Intentionally include all scripts and lock-like filenames rather than maintain
// an incomplete list of test tooling or environment providers.
export const globalTestChange = file => /^(?:\.github\/|scripts\/|packs\/|app\/datasets\/|app\/dataset[^/]*\.mjs$|app\/packs\.mjs$|app\/data\/.*\.(?:json|gz)$)/.test(file)
  || /(?:^|\/)(?:package\.json|npm-shrinkwrap\.json|[^/]*lock[^/]*)$/i.test(file)
  || /(?:^|\/)\.env(?:\.|$)/.test(file) || file === '.gitattributes';

export const inertChange = file => file === '.gitignore' || /^(?:\.local|\.git)\//.test(file);

// Prefix rules cover changed, added, deleted and renamed directory members.
export const ruleMatches = (rule, file) => rule.prefixes?.some(prefix => file.startsWith(prefix)) || rule.changes?.test(file);

// Non-import contracts: these tests inspect files, routes, or repository trees.
export const affectedRules = [
  { prefixes: ['docs/', 'app/web/'], changes: /^(?:README\.md|app\/data\/roadmap\.json)$/,
    tests: /^docs-menu-paths\.test\.mjs$/ },
  { changes: /^(?:app\/.*\.mjs$|app\/web\/|app\/server|app\/http)/,
    tests: /^(?:server|browser-module-graph)\.test\.mjs$/ },
  { changes: /^(?:docs\/save-surface\.json$|app\/storage\/|app\/core\/state)/,
    tests: /^(?:save-surface|storage-static|journal-.*)\.test\.mjs$/ },
  { changes: /^scripts\/linux\/offhost/,
    tests: /^linux-offhost.*\.test\.mjs$/ },
];
