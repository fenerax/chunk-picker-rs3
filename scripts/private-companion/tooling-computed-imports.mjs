// Audited computed imports. Unknown expressions fail closed instead of hiding
// indirect executable dependencies. Candidate app modules remain lane inputs.
export function computedToolingTargets(owner, expression) {
  const name = owner.replace(/^checks\/private-source\/scripts\/private-companion\//, 'tools/');
  const declarations = {
    'tools/cutover-runbook.mjs': {
      "pathToFileURL(path.join(c.coreRoot,'app/datasets.mjs'))": [],
      "pathToFileURL(path.join(c.coreRoot,'app/dataset-binding.mjs'))": [],
    },
    'tools/release-v2.mjs': {
      "pathToFileURL(path.join(assembly,'scripts/test-selection.mjs'))": ['checks/private-source/scripts/test-selection.mjs'],
      "pathToFileURL(path.join(kit,'checks/private-source/scripts/adaptive-test-runner.mjs'))": ['checks/private-source/scripts/adaptive-test-runner.mjs'],
    },
    'tools/post-merge-private.mjs': {
      "pathToFileURL(path.join(assembly,'scripts/test-selection.mjs'))": ['checks/private-source/scripts/test-selection.mjs'],
      "pathToFileURL(path.join(kit,'checks/private-source/scripts/adaptive-test-runner.mjs'))": ['checks/private-source/scripts/adaptive-test-runner.mjs'],
    },
    'tools/companion-check.mjs': {
      "pathToFileURL(path.join(scratch,'scripts',lane==='addon'?'build-private-addon.mjs':'build-dataset-profile.mjs'))": ['checks/private-source/scripts/build-private-addon.mjs', 'checks/private-source/scripts/build-dataset-profile.mjs'],
    },
    'tools/public-core-gate.mjs': {
      "pathToFileURL(path.join(tooling,'scan.mjs'))": ['checks/private-source/scripts/public-export/scan.mjs'],
      "pathToFileURL(path.join(tooling,'fingerprints.mjs'))": ['checks/private-source/scripts/public-export/fingerprints.mjs'],
    },
    'tools/release-preflight.mjs': {
      'prefix+key': [], // Object-only candidate module loader, independently checked by candidate preflight.
      "pathToFileURL(awaitregular(path.join(source,'scripts/private-companion/release-identity.mjs')))": ['checks/private-source/scripts/private-companion/release-identity.mjs'],
      "pathToFileURL(awaitregular(path.join(tooling,'scan.mjs')))": ['checks/private-source/scripts/public-export/scan.mjs'],
      "pathToFileURL(awaitregular(path.join(tooling,'fingerprints.mjs')))": ['checks/private-source/scripts/public-export/fingerprints.mjs'],
    },
    'tools/gallery-check.mjs': {
      'pathToFileURL(path.join(scratch,catalogueName)).href': [],
      "pathToFileURL(path.join(scratch,'scripts/perf/cdp.mjs')).href": ['checks/private-source/scripts/perf/cdp.mjs'],
      'pathToFileURL(checker).href+`?companion-gallery=${mode}`': ['tools/gallery-browser-check.mjs'],
    },
    'tools/gallery-browser-check.mjs': {
      "pathToFileURL(path.resolve('scripts/perf/cdp.mjs'))": ['checks/private-source/scripts/perf/cdp.mjs'],
      "pathToFileURL(path.resolve('app/web/gallery-catalogue.mjs'))": [],
    },
    'tools/live-base-compatibility.mjs': {
      "pathToFileURL(path.join(kit,'tools/check-private-drift.mjs'))": ['tools/check-private-drift.mjs'],
    },
    'tools/tooling-smoke.mjs': {
      'pathToFileURL(runner)': ['checks/private-source/scripts/adaptive-test-runner.mjs'],
      'pathToFileURL(retry)': ['tools/retry-failed-files.mjs'],
    },
    'checks/private-source/scripts/adaptive-test-runner.mjs': {
      'pathToFileURL(selection).href': ['checks/private-source/scripts/test-selection.mjs'],
    },
    'checks/private-source/scripts/build-dataset-profile.mjs': {
      'pathToFileURL(catalogueModule).href': [], 'pathToFileURL(defaultsModule).href': [],
    },
  };
  // These import fixed candidate application modules, whose bytes belong to the
  // exact candidate lanes and bounded live compatibility, not tooling identity.
  if (['tools/release-early.mjs', 'tools/release-pack-check.mjs', 'tools/release-text.mjs', 'tools/verify-install.mjs', 'tools/gallery-check.mjs'].includes(name)
    && /^pathToFileURL\(path\.join\(core,['"]app\/[a-zA-Z0-9._/-]+\.mjs['"]\)\)(?:\.href)?$/.test(expression)) return [];
  const targets = declarations[name]?.[expression];
  if (!targets) throw Error('Unmodeled computed tooling import: ' + name + ' (' + expression + ')');
  return targets;
}
