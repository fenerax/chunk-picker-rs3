import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';

// These sidecars are published only after the current gameplay state exists.
// Binding, access-token, empty directories, static blobs and unpublished .tmp
// files can precede the first state publication and do not prove a lost save.
const savedSidecars = new Set(['action-acknowledgements.json', 'accounts.json',
  'invites.json', 'feedback.json', 'usage.json', 'plugin-keys.json', 'overlays.json',
  'plugin-achievements.json', 'plugin-items.json', 'plugin-item-journal-beta.json',
  'plugin-item-journal-unknown.json', 'plugin-item-journal-commits.json']);
const evidenceDirectories = new Set(['backups', 'history', 'receipt-quarantine']);

async function entries(directory) {
  try { return await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return []; }
}
async function hasPublishedEvidence(directory) {
  for (const entry of await entries(directory)) {
    if (entry.name.endsWith('.tmp')) continue;
    if (!entry.isDirectory() || await hasPublishedEvidence(path.join(directory, entry.name))) return true;
  }
  return false;
}

/** Read-only admission check; callers recheck under store ownership/barriers. */
export async function checkStoreInitialization(directory) {
  try { await lstat(path.join(directory, 'state.json')); return true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const entry of await entries(directory)) {
    const corruptSidecar = /^(plugin-achievements|plugin-items)\.json\.corrupt-/.test(entry.name);
    if (savedSidecars.has(entry.name) || corruptSidecar
      || evidenceDirectories.has(entry.name) && (!entry.isDirectory() || await hasPublishedEvidence(path.join(directory, entry.name)))) {
      throw Object.assign(new Error('The saved group is missing state.json but prior gameplay evidence remains. Restore this group from a verified backup before opening it.'),
        { status: 503, code: 'SAVED_STATE_MISSING' });
    }
  }
  return false;
}
