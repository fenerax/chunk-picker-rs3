// Closed failure metadata only. Never return messages, paths, environment or output.
import crypto from 'node:crypto';
export const OPERATIONS = Object.freeze(['controller-contract', 'packet-directory', 'runtime-identity', 'runner-pins', 'readonly-mounts',
  'container-envelope', 'offline-container', 'controller-ancestors', 'bundle-manifest', 'bundle-schema', 'packet-payload',
  'portable-manifest', 'portable-runtime', 'source-tree', 'source-lock', 'playwright-package', 'browser-package',
  'browser-version-execute', 'browser-version-admit', 'scratch-copy', 'candidate-inputs', 'production-patch', 'production-write',
  'production-hashes', 'r109-install', 'native-environment', 'native-budget', 'native-execution', 'native-evidence', 'native-drain',
  'source-recheck', 'source-lock-recheck', 'result-send', 'unknown']);
export const ERROR_NAMES = Object.freeze(['Error', 'TypeError', 'SyntaxError', 'RangeError', 'ReferenceError', 'AggregateError', 'unknown']);
// Each authored code is an exact literal in the admitted adapter; system codes are fixed Node codes.
export const ERROR_CODES = Object.freeze(['controller-ipc-fd', 'packet-directory-outside-harness', 'runtime-identity', 'runner-pins',
  'immutable-image-admission', 'readonly-mount', 'hard-container-envelope', 'private-offline-container', 'controller-parent',
  'original-bundle-manifest', 'packet-protocol', 'packet-payload-hash', 'portable-runtime-hash', 'public-source-tree-mismatch',
  'source-symlink', 'source-special-file', 'source-lock-mismatch', 'source-lock-content-mismatch', 'source-lock-digest-mismatch',
  'playwright-package', 'browser-package', 'chromium-executable', 'controller-stopping', 'spawn-identity', 'child-ownership-changed',
  'native-output-cap', 'unexpected-native-ipc', 'controller-stopped', 'owned-child-deadline', 'unsafe-source-path', 'patch-encoding',
  'patch-file-header', 'patch-path-not-admitted', 'patch-duplicate-index', 'patch-index', 'patch-extra-header', 'patch-file-names',
  'patch-base-identity', 'patch-base-newline', 'patch-hunk', 'patch-hunk-range', 'patch-new-range', 'patch-truncated-hunk',
  'patch-hunk-line', 'patch-context-mismatch', 'patch-add-count', 'patch-no-hunks', 'patch-output-identity',
  'four-production-files-only', 'candidate-production-hash', 'wrapper-node-path', 'unadmitted-node-hook', 'wrapper-path-contract',
  'wrapper-dependency-contract', 'unexpected-application-selector', 'insufficient-native-and-drain-reserve', 'native-exit-or-output',
  'named-native-pass', 'actual-native-counts', 'native-evidence-cardinality', 'native-case-scope', 'complete-native-witness',
  'exact-r109-qualified-witness', 'real-later-slice', 'cached-fallback-provenance', 'fresh-body-render-join', 'exact-native-commands',
  'persisted-owner-history', 'fixture-drain-proof', 'proc-stat-format', 'ancestor-chain', 'proc-identity', 'container-ancestor-root',
  'container-descendants-remain', 'source-lock-changed', 'EACCES', 'EPERM', 'ENOENT', 'EEXIST', 'ENOSPC', 'EMFILE', 'ENFILE',
  'ENOTDIR', 'EISDIR', 'ELOOP', 'EINVAL', 'EIO', 'ENOMEM', 'ERR_IPC_CHANNEL_CLOSED', 'ERR_IPC_DISCONNECTED', 'unknown']);
export const DIAGNOSTIC_FLAGS = Object.freeze(['focusSourceTreeAdmitted', 'focusSourceLockAdmitted', 'focusPortableRuntimeAdmitted',
  'focusBrowserPinnedVersionMatched', 'focusBrowserExitPassed', 'focusNativeEnvironmentAdmitted']);
export const DIAGNOSTIC_METRICS = Object.freeze(['focusSourceFileCount', 'focusSourceLockFileCount', 'focusPatchedFileCount']);
export const BROWSER_BRANDS = Object.freeze(['chromium', 'google-chrome-for-testing', 'google-chrome', 'unknown']);
export function projectDiagnostic(value = {}) {
  const out = {};
  for (const [key, allowed] of [['focusOperation', OPERATIONS], ['focusErrorName', ERROR_NAMES], ['focusErrorCode', ERROR_CODES], ['focusBrowserBrand', BROWSER_BRANDS]])
    if (allowed.includes(value[key])) out[key] = value[key];
  for (const key of ['focusErrorStackSha256', 'focusBrowserVersionOutputSha256'])
    if (typeof value[key] === 'string' && /^[a-f0-9]{64}$/.test(value[key])) out[key] = value[key];
  for (const key of DIAGNOSTIC_FLAGS) if (typeof value[key] === 'boolean') out[key] = value[key];
  const metrics = {};
  for (const key of DIAGNOSTIC_METRICS) if (Number.isSafeInteger(value.metrics?.[key]) && value.metrics[key] >= 0 && value.metrics[key] <= 10000) metrics[key] = value.metrics[key];
  if (Object.keys(metrics).length) out.metrics = metrics;
  return out;
}
export function failureDiagnostic(error, operation, facts = {}) {
  const out = { ...projectDiagnostic(facts), focusOperation: OPERATIONS.includes(operation) ? operation : 'unknown',
    focusErrorName: ERROR_NAMES.includes(error?.name) ? error.name : 'unknown',
    focusErrorCode: ERROR_CODES.includes(error?.code) ? error.code : 'unknown' };
  if (typeof error?.stack === 'string' && Buffer.byteLength(error.stack) <= 65536)
    out.focusErrorStackSha256 = crypto.createHash('sha256').update(error.stack).digest('hex');
  return out;
}
export function browserVersionDiagnostic(raw, code, signal) {
  const text = typeof raw === 'string' ? raw : '';
  return { focusBrowserBrand: /^Google Chrome for Testing\b/m.test(text) ? 'google-chrome-for-testing'
    : /^Google Chrome\b/m.test(text) ? 'google-chrome' : /^Chromium\b/m.test(text) ? 'chromium' : 'unknown',
    focusBrowserPinnedVersionMatched: /\b151\.0\.7922\.34\b/.test(text), focusBrowserExitPassed: code === 0 && signal === null,
    focusBrowserVersionOutputSha256: crypto.createHash('sha256').update(text).digest('hex') };
}
