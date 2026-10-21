import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
export const maxFileBytes = 8 * 1024 * 1024;
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const stableJSON = value => `${JSON.stringify(value, null, 2)}\n`;
export const isMain = url => process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(url);
export const blocked = category => Object.assign(new Error('blocked, not clean'), { category });

export function safeRelative(value) {
  return typeof value === 'string' && value.length > 0 && !/[\\\u0000-\u001f\u007f:*?"<>|]/u.test(value)
    && !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part));
}

// Independent of the editable policy: a future broad entry cannot override these.
export function hardDenied(value) {
  const lower = value.toLowerCase();
  const parts = lower.split('/');
  return !safeRelative(value) || parts.some(part => ['.git', '.hg', '.svn', '.local', 'node_modules', 'fixtures'].includes(part))
    || /^(?:reference|archive|resources|docs\/research)(?:\/|$)/.test(lower)
    || (/^app\/data\//.test(lower) && lower !== 'app/data/training' && !lower.endsWith('.mjs'))
    || /^(?:app\/legacy-game-defaults\.mjs|app\/legacy-dataset-metadata\.mjs)$/.test(lower)
    || /(?:^|\/)(?:\.env(?:\..*)?|\.gitmodules|\.gitconfig|\.firebaserc|firebase\.json|access-token|save_file\.json|store\.lock)$/i.test(lower)
    || /(?:^|\/)(?:capture(?:d)?(?:[-_.]|$)|.*(?:profile|quests)\.json$)/i.test(lower)
    || /^app\/web\/task-item-artwork/.test(lower);
}

export function validateRules(rules) {
  if (rules?.schemaVersion !== 1 || !/^[a-z0-9.-]+$/i.test(rules.rulesVersion ?? '') || !Array.isArray(rules.entries)
    || !Array.isArray(rules.deniedPaths) || rules.deniedPaths.some(value => !safeRelative(value))) throw blocked('invalid-rules');
  for (const entry of rules.entries) {
    if (!entry || typeof entry.reason !== 'string' || !entry.reason.trim()) throw blocked('invalid-rules');
    if ((Object.hasOwn(entry, 'transform') || Object.hasOwn(entry, 'omitTests')) && !entry.path) throw blocked('invalid-rules');
    if (entry.path) {
      if (!safeRelative(entry.path) || entry.glob || hardDenied(entry.path)) throw blocked('invalid-rules');
      if (Object.hasOwn(entry, 'transform') && (entry.transform !== 'synthetic-test-identities-v1'
        || !/^tests\/(?:[\w.-]+\.test\.mjs|browser-screen-harness\.mjs|helpers\/[\w.-]+\.mjs)$/.test(entry.path))) throw blocked('invalid-rules');
      if (Object.hasOwn(entry, 'omitTests') && (!entry.transform || !Array.isArray(entry.omitTests)
        || entry.omitTests.some(row => typeof row.title !== 'string' || !row.title || !/^[a-f0-9]{64}$/.test(row.sha256 ?? '')
          || typeof row.reason !== 'string' || !row.reason.trim()))) throw blocked('invalid-rules');
    } else if (entry.tree) {
      // Only independently reviewed dataset payloads grow as a subtree.
      if (entry.tree !== 'app/datasets/open-f2p' || entry.glob || entry.path) throw blocked('invalid-rules');
    } else if (entry.family) {
      if (!['scripts/open-f2p', 'tests/open-f2p'].includes(entry.family)) throw blocked('invalid-rules');
    } else {
      // Only one filename wildcard in a fixed directory; explicit reviewed membership still required.
      if (typeof entry.glob !== 'string' || !/^[\w/-]+\/\*\.[a-z0-9]+$/.test(entry.glob) || !Array.isArray(entry.reviewedPaths)
        || entry.reviewedPaths.some(value => !safeRelative(value) || hardDenied(value) || !matchesGlob(entry.glob, value))) throw blocked('invalid-rules');
    }
  }
  for (const [target, source] of Object.entries(rules.overrides ?? {})) {
    if (!safeRelative(target) || hardDenied(target) || !safeRelative(source)
      || !source.startsWith('scripts/public-export/templates/')) throw blocked('invalid-rules');
  }
  return rules;
}

function matchesGlob(glob, value) {
  const [prefix, suffix] = glob.split('*');
  return value.startsWith(prefix) && value.endsWith(suffix) && !value.slice(prefix.length).includes('/');
}

export function isAllowed(value, rules) {
  if (hardDenied(value) || rules.deniedPaths.some(denied => denied.toLowerCase() === value.toLowerCase())) return false;
  return rules.entries.some(entry => entry.path === value
    || (entry.tree && value.startsWith(`${entry.tree}/`) && /(?:\.(?:json|mjs|md|txt)|\/(?:NOTICE|LICENSE))$/.test(value))
    || (entry.family === 'tests/open-f2p' && /^tests\/open-f2p(?:[.-][\w.-]+)?\.test\.mjs$/.test(value))
    || (entry.family === 'scripts/open-f2p' && /^scripts\/(?:build|fetch)-open-f2p(?:[.-][\w.-]+)?\.mjs$/.test(value))
    || (entry.glob && matchesGlob(entry.glob, value) && entry.reviewedPaths.includes(value)));
}

export function validateProvenance(document) {
  if (document?.schemaVersion !== 1 || !Array.isArray(document.files)) throw blocked('invalid-provenance');
  const seen = new Set();
  for (const file of document.files) {
    if (!safeRelative(file?.path) || !/^app\/web\/(?:placeholder-art\/[\w.-]+|favicon)\.svg$/.test(file.path)
      || !/^[a-f0-9]{64}$/.test(file.sha256 ?? '') || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > maxFileBytes
      || typeof file.authoring !== 'string' || !file.authoring.trim() || seen.has(file.path)) throw blocked('invalid-provenance');
    seen.add(file.path);
  }
  return document;
}

export function approvedMedia(relativePath, bytes, provenance) {
  return provenance.files.some(file => file.path === relativePath && file.bytes === bytes.length && file.sha256 === sha256(bytes));
}

export function textBytes(bytes) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text) ? null : text;
  } catch { return null; }
}

export function allowedBytes(relativePath, bytes, provenance) {
  if (/\.(?:png|jpe?g|webp|gif|ico|woff2?|zip|gz)$/i.test(relativePath)) return false;
  const media = /\.svg$/i.test(relativePath);
  if (media) return approvedMedia(relativePath, bytes, provenance);
  if (!/\.(?:mjs|js|json|css|html|md|txt|tsv|ya?ml|map)$/i.test(relativePath) && !['.gitignore', '.gitattributes', 'LICENSE', 'NOTICE', 'app/web/placeholder-art/.gitattributes', 'app/datasets/open-f2p/wiki-derived/NOTICE'].includes(relativePath)) return false;
  return textBytes(bytes) !== null;
}

// Check each existing ancestor, including a directory junction on Windows.
export async function noLinks(absolutePath) {
  const resolved = path.resolve(absolutePath);
  let current = path.parse(resolved).root;
  for (const part of resolved.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink() || path.resolve(await realpath(current)).toLowerCase() !== path.resolve(current).toLowerCase()) throw blocked('symlink');
  }
}
