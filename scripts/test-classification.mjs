// Pure classification: callers inspecting committed or assembled sources supply
// their bytes here. Test modules are never imported to read their metadata.
import { existingTestExceptions } from './test-selection-exceptions.mjs';

export const testSuites = Object.freeze(['quick', 'full', 'differential', 'engine-differential']);
// validateLanes accepts scratch direct-peer lanes only on 8900-8999. The http
// test scans for a free port; the lanes test passes ports as data, never listens.
export const reviewedFixedPortTests = new Set(['private-frontdoor-http.test.mjs', 'private-frontdoor-lanes.test.mjs']);
const classes = { quick: 'quick', full: 'full-only', differential: 'differential-only', 'engine-differential': 'engine-differential-only' };
const openF2PEnvironment = Object.freeze({ RS3_DATASET: 'open-f2p', ...Object.fromEntries(['RS3_PACKS_DIR', 'RS3_PACK_SELECTION',
  'RS3_MAP_ASSETS_DIR', 'RS3_TERRAIN_ASSETS_DIR', 'RS3_ICON_ASSETS_DIR', 'RS3_GAME_DATA_DIR', 'RS3_PUBLIC_ORIGIN', 'RS3_LOOPBACK_PORT', 'RS3_LOOPBACK_ROLE', 'RS3_SIGNIN',
  'RS3_DISCORD_CLIENT_ID', 'RS3_DISCORD_CLIENT_SECRET_FILE', 'RS3_GOOGLE_CLIENT_ID', 'RS3_GOOGLE_CLIENT_SECRET_FILE',
  'RS3_DATASET_PROFILE', 'RS3_DATASET_PROFILE_SHA256'].map(key => [key, undefined])) });

function options(tokens, name) {
  const result = {};
  for (const token of tokens) {
    const [key, value] = Object.hasOwn(classes, token) ? ['classification', classes[token]]
      : ['solo', 'shared'].includes(token) ? ['solo', token === 'solo']
      : ['dataset=open-f2p', 'dataset=default'].includes(token) ? ['dataset', token.slice(8)] : [];
    if (!key || Object.hasOwn(result, key)) throw new Error(`Invalid @test option ${token} in ${name}`);
    result[key] = value;
  }
  return result;
}

const exceptions = new Map();
for (const [tag, names] of existingTestExceptions) {
  for (const stem of names.trim().split(/\s+/)) {
    const name = stem + '.test.mjs';
    if (exceptions.has(name)) throw new Error(`Duplicate test exception: ${name}`);
    exceptions.set(name, options(tag.split(' '), name));
  }
}

/** Optional first-line comment, after a BOM or shebang. Later comments/strings
 * cannot change selection. An absent tag always has the safe filename default. */
export function testHeader(source, name = 'test') {
  const first = String(source).replace(/^\uFEFF/, '').replace(/^#![^\n]*\n/, '').split(/\r?\n/, 1)[0];
  const match = /^\/\/\s*@test(?:\s+(.*?))?\s*$/.exec(first);
  return match ? options((match[1] ?? '').trim().split(/\s+/).filter(Boolean), name) : {};
}

export function createTestSelection(sources = new Map()) {
  const metadata = new Map([...sources].filter(([name]) => name.endsWith('.test.mjs'))
    .map(([name, source]) => [name, { ...exceptions.get(name), ...testHeader(source, name) }]));
  const policyFor = name => metadata.get(name) ?? exceptions.get(name) ?? {};
  const classifyTest = name => {
    if (!name.endsWith('.test.mjs')) return null;
    const classification = policyFor(name).classification;
    if (classification) return classification;
    // Preserve the suite of split private scenarios, but never inherit a
    // parent's dataset/solo policy: those have always been per entrypoint.
    const shared = name.replace(/\.private\.test\.mjs$/, '.test.mjs');
    return shared !== name ? classifyTest(shared) : 'full-only';
  };
  const testRunPolicy = name => {
    const { solo = false, dataset } = policyFor(name);
    return { solo, ...(dataset === 'open-f2p' ? { env: openF2PEnvironment } : {}) };
  };
  const selectTests = (names, suite = 'quick') => {
    if (!testSuites.includes(suite)) throw new Error('Suite must be quick, full, differential or engine-differential');
    const selected = [...names].filter(name => name.endsWith('.test.mjs')).sort().filter(name => {
      const classification = classifyTest(name);
      return suite === 'full' ? ['quick', 'full-only'].includes(classification) : classification === classes[suite];
    });
    if (!selected.length) throw new Error('No tests selected for ' + suite);
    return selected;
  };
  const names = [...metadata.keys()].sort();
  return { classifyTest, testRunPolicy, selectTests,
    // Retain the exported set's meaning: direct quick opt-ins, without private
    // scenarios that inherit suite membership from their shared counterpart.
    quickTests: new Set(names.filter(name => policyFor(name).classification === 'quick')),
    soloTests: new Set(names.filter(name => testRunPolicy(name).solo)),
    openF2PTests: new Set(names.filter(name => testRunPolicy(name).env)),
    differentialTests: new Set(names.filter(name => classifyTest(name) === 'differential-only')),
    engineDifferentialTests: new Set(names.filter(name => classifyTest(name) === 'engine-differential-only')) };
}
