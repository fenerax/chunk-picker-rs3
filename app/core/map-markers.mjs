const symbols = {
  skull: '☠', 'skull-crossbones': '☠', bomb: '●', 'exclamation-circle': '!', dice: '⚄', poo: '●', frown: '☹', 'grin-alt': '☺', heart: '♥', star: '★', gem: '◆', award: '✪', crown: '♛', flag: '⚑', asterisk: '✱', clock: '◷', hourglass: '⌛', link: '↔', 'map-marker-alt': '●', 'radiation-alt': '☢', 'shoe-prints': '⋮', 'thumbs-down': '↓', 'thumbs-up': '↑', crow: '♟', 'utensil-spoon': '♧', lock: '▣', 'unlock-alt': '▢', sailboat: '⛵', anchor: '⚓', 'circle-question': '?',
};
const rs3 = ['attack', 'constitution', 'mining', 'strength', 'agility', 'smithing', 'defence', 'herblore', 'fishing', 'ranged', 'thieving', 'cooking', 'prayer', 'fletching', 'firemaking', 'magic', 'crafting', 'woodcutting', 'runecrafting', 'slayer', 'farming', 'construction', 'hunter', 'summoning', 'dungeoneering', 'divination', 'invention', 'archaeology', 'necromancy', 'quest', 'achievements', 'minigame', 'skills', 'clue'];
const numbers = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
export const stickerDefinitions = Object.freeze([
  ...Object.entries(symbols).map(([id, glyph]) => ({ id, glyph, kind: 'symbol' })),
  ...rs3.map(id => ({ id, kind: 'rs3', iconUrl: `/assets/SVG/rs3/${id}-rs3.svg` })),
  ...numbers.map((id, index) => ({ id, glyph: String(index), kind: 'number' })),
  ...['S', 'A', 'B', 'C', 'D', 'F'].map(id => ({ id, glyph: id, kind: 'tier' })),
].map(definition => Object.freeze({ ...definition, label: definition.id.replaceAll('-alt', '').replaceAll('-', ' ') })));
const stickerIds = new Set(stickerDefinitions.map(definition => definition.id));
const baseChunk = value => typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
export const MAX_STICKERS_PER_CHUNK = 6;

export function validateStickerId(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/.test(id)) throw new TypeError('Sticker ID must be a nonempty safe identifier');
}

export function validateSticker(sticker) {
  if (sticker === null) return;
  if (typeof sticker !== 'object' || Array.isArray(sticker)) throw new TypeError('Sticker must be an object or null');
  for (const key of Object.keys(sticker)) if (!['type', 'color', 'text'].includes(key)) throw new TypeError(`Unknown sticker field: ${key}`);
  if (!stickerIds.has(sticker.type)) throw new TypeError(`Unknown sticker type: ${sticker.type}`);
  if (typeof sticker.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(sticker.color)) throw new TypeError('Sticker color must be #RRGGBB');
  if (typeof sticker.text !== 'string') throw new TypeError('Sticker text must be a string');
}

export function validateStickerList(stickers) {
  if (!Array.isArray(stickers)) throw new TypeError('Stickers must be an ordered list');
  if (stickers.length > MAX_STICKERS_PER_CHUNK) throw new TypeError(`A chunk can have at most ${MAX_STICKERS_PER_CHUNK} stickers`);
  const ids = new Set();
  for (const sticker of stickers) {
    if (sticker === null || typeof sticker !== 'object' || Array.isArray(sticker)) throw new TypeError('Sticker must be an object');
    const { id, ...content } = sticker;
    validateStickerId(id); validateSticker(content);
    if (ids.has(id)) throw new TypeError(`Duplicate sticker ID: ${id}`);
    ids.add(id);
  }
}

// Previous saves used one content object or null. Keep its identity stable
// across reloads, command guards and historical undo values.
export function normalizeStickerList(value, chunkId) {
  if (Array.isArray(value)) { validateStickerList(value); return value.map(sticker => ({ ...sticker })); }
  validateSticker(value);
  return value === null ? [] : [{ id: `legacy-sticker-${chunkId}`, ...value }];
}

export function validateSavedStickers(value) {
  if (Array.isArray(value)) validateStickerList(value);
  else validateSticker(value);
}

export function resolveMemberStickers(state, member) {
  const chunks = state.legacy?.maps?.[member.sourceMapId]?.chunks ?? {}, stickers = {};
  for (const [rawId, rawType] of Object.entries(chunks.stickered ?? {})) {
    const id = decodeLegacyText(rawId).replace(/^\*fb\*_/, ''), type = decodeLegacyText(rawType);
    if (!baseChunk(id) || !stickerIds.has(type)) continue;
    const color = decodeLegacyText(chunks.stickeredColors?.[rawId] ?? chunks.stickeredColors?.[id]), text = decodeLegacyText(chunks.stickeredNotes?.[rawId] ?? chunks.stickeredNotes?.[id]);
    stickers[id] = [{ id: `legacy-sticker-${id}`, type, color: typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color : '#FFFFFF', text: typeof text === 'string' ? text : '' }];
  }
  for (const [id, sticker] of Object.entries(member.stickers ?? {})) {
    stickers[id] = normalizeStickerList(sticker, id);
  }
  return stickers;
}

export function resolveStartingChunk(state, member) {
  const value = Object.hasOwn(member.preferences ?? {}, 'startingChunk') ? member.preferences.startingChunk : state.legacy?.maps?.[member.sourceMapId]?.settings?.startingChunk;
  return baseChunk(value) ? value : null;
}
import { decodeLegacyText } from '../tasks/gameplay-compat.mjs';
