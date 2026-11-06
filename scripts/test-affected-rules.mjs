// Non-import contracts: these tests inspect files, routes, or repository trees.
// Keep this map small; import reachability handles ordinary module dependencies.
export const affectedRules = [
  { changes: /^(?:app\/.*\.mjs$|app\/web\/|app\/server|app\/http)/,
    tests: /^(?:server|browser-module-graph)\.test\.mjs$/ },
  { changes: /^(?:docs\/save-surface\.json$|app\/storage\/|app\/core\/state)/,
    tests: /^(?:save-surface|storage-static|journal-.*)\.test\.mjs$/ },
  { changes: /^(?:app\/(?:data|datasets)\/|\.github\/packs\/|scripts\/(?:build-open-f2p|fetch-open-f2p|ci\/coverage-inputs))/,
    tests: /^(?:ci-(?:coverage-inputs|cache-inputs-pack|pack-fetch)|dataset-packs|pack-public-scrub|save-surface|open-f2p.*)\.test\.mjs$/ },
  { changes: /^\.github\/(?:workflows\/|coverage-allowlist\.json$|windows-slice\/)/,
    tests: /^(?:ci-.*|test-selection.*|test-run-policy|y03-fuzz-ci.*|release-ci-evidence-workflow-harness)\.test\.mjs$/ },
  { changes: /^scripts\/linux\/offhost/,
    tests: /^linux-offhost.*\.test\.mjs$/ },
  { changes: /^(?:scripts\/(?:test(?:-|\.)|adaptive-test-runner|ci\/test-)|package\.json$)/,
    tests: /^(?:ci-.*|test-.*|adaptive-test-runner)\.test\.mjs$/ },
];
