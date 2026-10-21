// Private compatibility data. Independent games supply their own configuration
// and do not load this module.
//
// The tracked members are placeholders. A real install names an untracked JSON
// file in RS3_GAME_DEFAULTS_FILE (absolute path) holding its own members and
// master label, so live ids never enter the repository:
//   { "members": [{ "id": "...", "name": "...", "mapId": "..." }, ...], "masterLabel": "Player 1" }
// A named file that is missing or invalid stops the import instead of falling back.
import path from 'node:path';
import { readFileSync } from 'node:fs';

const placeholders = Object.freeze({
  members: Object.freeze([
    Object.freeze({ id: 'player1', name: 'Player 1', mapId: 'qxa' }),
    Object.freeze({ id: 'player2', name: 'Player 2', mapId: 'qxb' }),
  ]),
  masterLabel: 'Player 1',
});
const compatibility = Object.freeze({
  worldImagesPath: Object.freeze(['reference', 'original-picker']),
  notableExplorationTaskId: 'rs3:task:0040ec',
});

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const key = /^[a-zA-Z0-9_-]{1,80}$/;
const label = value => typeof value === 'string' && !!value && value.length <= 200 && !/[\u0000-\u001f\u007f]/u.test(value);

export function parseLocalGameDefaults(value) {
  const invalid = () => { throw new TypeError('Invalid local game defaults.'); };
  if (!plain(value) || Object.keys(value).some(name => !['members', 'masterLabel'].includes(name))) invalid();
  if (!Array.isArray(value.members) || !value.members.length || value.members.length > 32 || !label(value.masterLabel)) invalid();
  const ids = new Set();
  const members = value.members.map(member => {
    if (!plain(member) || Object.keys(member).some(name => !['id', 'name', 'mapId'].includes(name))
      || typeof member.id !== 'string' || !key.test(member.id) || ids.has(member.id) || !label(member.name)
      || (member.mapId !== undefined && (typeof member.mapId !== 'string' || !key.test(member.mapId)))) invalid();
    ids.add(member.id);
    return Object.freeze({ id: member.id, name: member.name, ...(member.mapId === undefined ? {} : { mapId: member.mapId }) });
  });
  return Object.freeze({ members: Object.freeze(members), masterLabel: value.masterLabel });
}

function localDefaults(file = process.env.RS3_GAME_DEFAULTS_FILE) {
  if (file === undefined || file === '') return placeholders;
  if (!path.isAbsolute(file)) throw new TypeError('RS3_GAME_DEFAULTS_FILE must be an absolute path.');
  let text;
  try { text = readFileSync(file, 'utf8'); }
  catch { throw new TypeError('RS3_GAME_DEFAULTS_FILE could not be read.'); }
  // Parse errors can quote the file, so report none of it.
  let value;
  try { value = JSON.parse(text.replace(/^﻿/, '')); }
  catch { throw new TypeError('RS3_GAME_DEFAULTS_FILE is not valid JSON.'); }
  return parseLocalGameDefaults(value);
}

const chosen = localDefaults();
export const legacyGameDefaults = Object.freeze({
  members: chosen.members,
  masterLabel: chosen.masterLabel,
  compatibility,
});
