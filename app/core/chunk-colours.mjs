import { decodeLegacyText } from '../tasks/gameplay-compat.mjs';

// Authored annotations have four stable slots. Labels can change; these IDs
// and their display colours stay fixed and never influence access or tasks.
export const CHUNK_COLOURS = Object.freeze([
  { id: 'red', label: 'Red', color: '#e66b73' },
  { id: 'yellow', label: 'Yellow', color: '#e5c35a' },
  { id: 'green', label: 'Green', color: '#63b88a' },
  { id: 'blue', label: 'Blue', color: '#669de0' },
].map(Object.freeze));
export const LEGACY_CHUNK_COLOURS = Object.freeze([
  ...CHUNK_COLOURS,
  { id: 'orange', label: 'Orange', color: '#ffa500' },
  { id: 'pink', label: 'Pink', color: '#ffc0cb' },
  { id: 'purple', label: 'Purple', color: '#800080' },
  { id: 'black', label: 'Black', color: '#000000' },
].map(Object.freeze));
export const MAX_CHUNK_COLOUR_NAME_LENGTH = 24;
const ids = new Set(CHUNK_COLOURS.map(colour => colour.id));
const legacyIds = new Set(LEGACY_CHUNK_COLOURS.map(colour => colour.id));
const baseChunk = value => typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));

export function validateChunkColour(colour, { allowClear = true } = {}) {
  if (colour === null && allowClear) return;
  if (!ids.has(colour)) throw new TypeError(`Unknown chunk colour: ${colour}`);
}

export function validateChunkColourName(name) {
  if (typeof name !== 'string' || !name.trim() || name !== name.trim() || name.length > MAX_CHUNK_COLOUR_NAME_LENGTH || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new TypeError(`Chunk colour name must be a trimmed single-line string of 1–${MAX_CHUNK_COLOUR_NAME_LENGTH} characters`);
  }
}

export function applyChunkColourCommand(member, command) {
  if (command.type === 'set-chunk-colour') {
    validateChunkColour(command.colour);
    member.chunkColours = { ...(member.chunkColours ?? {}), [command.chunkId]: command.colour };
  } else if (command.type === 'rename-chunk-colour') {
    validateChunkColour(command.colour, { allowClear: false }); validateChunkColourName(command.name);
    member.chunkColourNames = { ...(member.chunkColourNames ?? {}), [command.colour]: command.name };
  } else throw new TypeError('Unknown chunk colour command');
}

export function resolveMemberChunkColourNames(_state, member) {
  return Object.fromEntries(LEGACY_CHUNK_COLOURS.map(colour => [colour.id, member.chunkColourNames?.[colour.id] ?? colour.label]));
}

// Keep every recognized original paint in its saved order. The old picker
// offered eight colours and up to four per chunk; the raw copy remains intact.
// A personal null override is an explicit clear, including inherited paints.
export function resolveMemberChunkColours(state, member) {
  const painted = state.legacy?.maps?.[member.sourceMapId]?.chunks?.painted ?? {}, result = {};
  for (const [rawId, values] of Object.entries(painted)) {
    const id = decodeLegacyText(rawId).replace(/^\*fb\*_/, '');
    if (!baseChunk(id) || !Array.isArray(values)) continue;
    const colours = [];
    for (const value of values) {
      if (typeof value !== 'string') continue;
      const colour = decodeLegacyText(value).toLowerCase();
      if (legacyIds.has(colour) && !colours.includes(colour)) colours.push(colour);
    }
    if (colours.length) result[id] = colours;
  }
  for (const [id, colour] of Object.entries(member.chunkColours ?? {})) result[id] = colour === null ? [] : [colour];
  return result;
}
