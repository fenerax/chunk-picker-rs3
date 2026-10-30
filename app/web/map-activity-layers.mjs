import { gameStorage, observePickerStorage } from './screen-save-status.mjs';
import { buildMapActivityLayers } from './map-activity-layer-model.mjs';

const STORAGE_KEY = 'picker.activity-layers';
export const CLUE_TIERS = ['easy', 'medium', 'hard', 'elite', 'master'];
const title = value => value[0].toUpperCase() + value.slice(1);
const empty = () => ({ clues: new Map(), slayer: new Map() });

/** Browser-only map choices. Opting in loads the existing definitions once. */
export function createMapActivityLayers(c, options = {}) {
  if (c.supportsFeature?.('rsCatalogues') === false) return {
    preferences: { clueTier: 'off', showSlayer: false }, refresh() {}, sync() {},
    controls: () => c.el('span'), model: empty,
  };
  let storage;
  try { storage = options.storage ?? gameStorage(); } catch {}
  const preferences = { clueTier: 'off', showSlayer: false };
  function loadPreferences() {
  preferences.clueTier = 'off'; preferences.showSlayer = false;
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '{}');
    if (['off', 'all', ...CLUE_TIERS].includes(saved.clueTier)) preferences.clueTier = saved.clueTier;
    if (typeof saved.showSlayer === 'boolean') preferences.showSlayer = saved.showSlayer;
  } catch {}
  }
  loadPreferences(); observePickerStorage(loadPreferences);
  let model = empty(), status = '', key, modelWorld, request = 0, data, dataRequest;
  const rows = new Map();
  const enabled = () => preferences.clueTier !== 'off' || preferences.showSlayer;
  const scope = () => c.state && `${c.state.revision}:${c.memberId}:${c.sandbox?.active === true}`;

  function description() {
    if (status) return status;
    const clues = [...model.clues].filter(([, rows]) => rows.some(row => preferences.clueTier === 'all' || row.tier === preferences.clueTier)).length;
    const clueText = model.clues.size ? `${preferences.clueTier === 'all' ? 'All clue tiers' : title(preferences.clueTier)} · ${clues} ${clues === 1 ? 'chunk' : 'chunks'}. ` : '';
    const slayerText = model.slayerLabel ? `${model.slayerLabel} · ${model.slayer.size} ${model.slayer.size === 1 ? 'chunk' : 'chunks'}. ` : '';
    return [preferences.clueTier !== 'off' ? clueText + (model.clueNote ?? '') : '', preferences.showSlayer ? slayerText + (model.slayerNote ?? '') : ''].filter(Boolean).join(' ');
  }

  function sync() {
    for (const row of rows.values()) {
      row.clues.value = preferences.clueTier;
      row.slayer.checked = preferences.showSlayer;
      row.note.textContent = description();
      row.note.hidden = !row.note.textContent;
    }
  }

  function paint() {
    c.map?.setActivityLayerPreferences?.(preferences);
    sync();
    c.renderLegend?.();
  }

  function change(id, value) {
    preferences[id] = value;
    try { storage?.setItem(STORAGE_KEY, JSON.stringify(preferences)); } catch {}
    paint();
    void refresh();
  }

  async function refresh() {
    c.map?.setActivityLayerPreferences?.(preferences);
    if (!enabled()) {
      request++; key = undefined; status = ''; model = empty();
      c.map?.setActivityLayers?.(model); sync(); return;
    }
    if (!c.state || !c.member() || !c.map) return;
    const current = scope(), world = c.world;
    if (key === current && modelWorld === world) { sync(); return; }
    key = current; modelWorld = world;
    const attempt = ++request;
    model = empty(); c.map.setActivityLayers?.(model);
    status = 'Finding map locations…'; sync();
    try {
      data ??= await (dataRequest ??= c.api('/api/definitions?view=map-layers-v1').finally(() => { dataRequest = undefined; }));
      if (attempt !== request || current !== scope() || world !== c.world || !enabled()) return;
      model = buildMapActivityLayers({ definitions: data, world, state: c.state, memberId: c.memberId });
      status = ''; c.map.setActivityLayers?.(model); sync(); c.renderLegend?.();
    } catch {
      if (attempt !== request || current !== scope()) return;
      key = undefined; status = 'Map locations could not load. Turn the layer off and on to retry.'; sync();
    }
  }

  function controls(placement = 'display') {
    const group = c.el('div', undefined, `map-activity-controls map-activity-${placement}`);
    const clueRow = c.el('label', undefined, 'map-activity-option');
    const swatch = c.el('i', undefined, 'swatch swatch-clue-layer'); swatch.setAttribute('aria-hidden', 'true');
    const clues = c.el('select'); clues.id = `map-activity-clues-${placement}`;
    clues.setAttribute('aria-label', 'Clue steps on map');
    for (const [value, label] of [['off', 'Off'], ['all', 'All tiers'], ...CLUE_TIERS.map(tier => [tier, title(tier)])]) {
      const option = c.el('option', label); option.value = value; clues.append(option);
    }
    clues.value = preferences.clueTier;
    clues.addEventListener('change', () => change('clueTier', clues.value));
    clueRow.append(swatch, c.el('span', 'Clue steps'), clues);
    const slayerRow = c.el('label', undefined, 'map-activity-option');
    const slayer = c.input('checkbox'); slayer.id = `map-activity-slayer-${placement}`;
    slayer.checked = preferences.showSlayer;
    slayer.addEventListener('change', () => change('showSlayer', slayer.checked));
    const slayerSwatch = c.el('i', undefined, 'swatch swatch-slayer-layer'); slayerSwatch.setAttribute('aria-hidden', 'true');
    slayerRow.append(slayer, slayerSwatch, c.el('span', 'Locked Slayer task'));
    const note = c.el('p', description(), 'map-display-note'); note.hidden = !note.textContent;
    note.setAttribute('role', 'status');
    group.append(clueRow, slayerRow, note);
    rows.set(placement, { clues, slayer, note });
    return group;
  }

  return { preferences, refresh, controls, sync, model: () => model };
}
