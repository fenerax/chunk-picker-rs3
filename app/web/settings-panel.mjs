import { datasetStatusText } from './dataset-status.mjs';
import { settingDefinitions } from './data/settings.mjs';
import { createDeathSettings } from './death-settings.mjs';
import { createMiningSettings } from './mining-settings.mjs';
import { createWoodcuttingSettings } from './woodcutting-settings.mjs';
import { createBankingSettings } from './banking-settings.mjs';
import { artStatusText } from './art-status.mjs';

export const implementedPreferences = new Set(['highvis', 'roll2', 'unpick', 'randomStartAlways', 'newTasks', 'recent', 'info', 'chunkTasks', 'topButtons', 'completedTaskColor', 'completedTaskStrikethrough', 'defaultStickerColor', 'cinematicRoll', 'startingChunk', 'theme', 'taskSidebar', 'allTasks', 'hideChecked', 'ids', 'numTasksPercent', 'shiftUnlock', 'rollWarning', 'unlockedBorderColor', 'defaultChunkinfo', 'taskSearchbar', 'hideAchievements']);
const settingCopy = {
  theme: ['Theme', 'Choose the colours used throughout the picker.'],
  startingChunk: ['Starting flag', 'Choose the chunk marked as your starting point.'],
  roll2: ['Roll 2', 'Roll two chunks and keep one.'],
  unpick: ['Forfeit a chunk', 'Re-lock one of your chunks at random.'],
  randomStartAlways: ['Roll anywhere on walkable terrain', 'Roll a random locked chunk on walkable terrain.'],
  rollWarning: ['Ask before rolling', 'Show a quick are-you-sure before Roll 1 or Roll 2.'],
  cinematicRoll: ['Animate rolls', 'Reveal your new chunk with an animation.'],
  newTasks: ['New tasks popup', 'Show your new tasks after each roll.'],
  shiftUnlock: ['Shift-click unlock', 'When on, hold Shift and click a chunk to unlock or re-lock it. Ctrl/Cmd-click adds or removes locked chunks from the roll pool without unlocking them.'],
  chunkTasks: ['Task list', 'Show your active chunk tasks.'],
  taskSidebar: ['Wide task list', 'Give the task list more room.'],
  taskSearchbar: ['Task search', 'Show a search box above your tasks.'],
  hideChecked: ['Hide completed tasks', 'Keep completed tasks out of the active list.'],
  completedTaskStrikethrough: ['Cross out completed tasks', 'Draw a line through completed task names.'],
  completedTaskColor: ['Completed task colour', 'Choose the colour of completed tasks.'],
  numTasksPercent: ['Completion percentage', 'Show your task progress as a percentage.'],
  info: ['Chunk Info panel', 'Show details when you open a chunk.'],
  defaultChunkinfo: ['Open Chunk Info at', 'Choose the tab shown when you open Chunk Info.'],
  recent: ['Recent Chunks and History', 'Show your recent rolls and the History button.'],
  topButtons: ['BiS and Activity Info', 'Show the buttons for equipment and activity details.'],
  allTasks: ['Intermediate skill tasks', 'Include intermediate skill goals in Activity Info.'],
  hideAchievements: ['Required achievements only', 'Limit Activity Info to achievements required by your rules.'],
};
const sections = [
  { id: 'map', label: 'Map', ids: ['theme', 'startingChunk'] },
  { id: 'rolling', label: 'Rolling', ids: ['roll2', 'unpick', 'randomStartAlways', 'rollWarning', 'cinematicRoll', 'newTasks', 'shiftUnlock'] },
  { id: 'tasks', label: 'Tasks', ids: ['chunkTasks', 'taskSidebar', 'taskSearchbar', 'hideChecked', 'completedTaskStrikethrough', 'completedTaskColor', 'numTasksPercent'] },
  { id: 'panels', label: 'Panels', ids: ['info', 'defaultChunkinfo', 'recent', 'topButtons', 'allTasks', 'hideAchievements'] },
  { id: 'time', label: 'Time estimates', ids: [] },
];
const optionLabels = {
  theme: { light: 'Light', dark: 'Dark', gray: 'Gray', terminal: 'Terminal', neon: 'Neon', pumpkin: 'Pumpkin', mono: 'Monochrome', winter: 'Winter', autumn: 'Autumn', voyage: 'Voyage' },
  defaultChunkinfo: { monsters: 'Monsters', npcs: 'NPCs', spawns: 'Item spawns', shops: 'Shops', features: 'Objects or features', quests: 'Quests', clues: 'Clues', connections: 'Connections', challenges: 'Tasks' },
};
const mapDisplayIds = new Set(['ids', 'highvis', 'unlockedBorderColor', 'defaultStickerColor']);
const sectionStorageKey = 'picker.settings-section';

export function createSettingsPanel(ctx) {
  const { el, button, input, select, field, details, openDialog, command, showError } = ctx;
  function settings() {
    if (ctx.canWrite?.() === false) return;
    const id = ctx.memberId(), owner = ctx.state().members.find(member => member.id === id);
    const activeSections = sections.filter(section => section.id !== 'time' || ctx.supportsFeature?.('training') !== false);
    const content = el('div', undefined, 'settings-panel');
    content.dataset.mobileView = 'list';
    const searchBar = el('div', undefined, 'settings-search'), search = input('search');
    search.placeholder = 'Find a setting'; search.setAttribute('aria-label', 'Find a setting');
    const clear = button('Clear', () => { search.value = ''; content.dataset.mobileView = 'detail'; render(); search.focus?.(); }, 'settings-clear');
    clear.hidden = true; searchBar.append(search, clear);
    const layout = el('div', undefined, 'settings-layout'), navigation = el('nav', undefined, 'settings-navigation');
    navigation.setAttribute('aria-label', 'Settings sections');
    const sectionLinks = el('div', undefined, 'settings-section-links'), advancedRow = el('div', undefined, 'settings-advanced');
    const advanced = input('checkbox'); advanced.id = `setting-${id}-advanced`; advanced.checked = ctx.preferences(id).advanced === true;
    const advancedLabel = el('label', 'Advanced'); advancedLabel.htmlFor = advanced.id;
    advanced.setAttribute('aria-label', 'Advanced'); advancedRow.append(advancedLabel, advanced);
    navigation.append(sectionLinks, advancedRow);
    const artworkStatus = el('p', undefined, 'art-status');
    const datasetStatus = el('p', undefined, 'art-status'); navigation.append(artworkStatus, datasetStatus);
    const body = el('div', undefined, 'settings-body'), back = button('‹ All settings', () => { content.dataset.mobileView = 'list'; navButtons.get(selected)?.focus?.(); }, 'settings-back');
    const rows = el('div', undefined, 'settings-sections'); body.append(back, rows); layout.append(navigation, body); content.append(searchBar, layout);
    let selected = 'map';
    try { const saved = localStorage.getItem(sectionStorageKey); if (activeSections.some(section => section.id === saved)) selected = saved; } catch { /* Section navigation works without browser storage. */ }
    const navButtons = new Map(), sectionHeadings = new Map();
    let renderGeneration = 0, miningSettings, woodcuttingSettings, bankingSettings, streamSafeRow;
    ctx.$?.('tool-dialog')?.addEventListener?.('close', () => streamSafeRow?.dispose?.(), { once: true });
    for (const section of activeSections) {
      const link = button(section.label, () => {
        selected = section.id; search.value = ''; content.dataset.mobileView = 'detail';
        try { localStorage.setItem(sectionStorageKey, selected); } catch { /* Remember only when storage is available. */ }
        render();
        sectionHeadings.get(selected)?.focus?.();
      }, 'settings-section-link');
      link.setAttribute('aria-controls', 'settings-section-content'); navButtons.set(section.id, link); sectionLinks.append(link);
    }
    rows.id = 'settings-section-content';
    const isAdvanced = () => ctx.preferences(id).advanced === true;
    async function savePreference(control, preferenceId, value, restore, after = () => {}) {
      const generation = ctx.dialogGeneration?.(), current = () => ctx.dialogCurrent?.(generation) ?? true;
      control.disabled = true;
      try { await command({ type: 'set-preference', memberId: id, preferenceId, value }); if (current()) after(); }
      catch (error) { if (current()) { restore(); showError(error); } }
      finally { if (current()) control.disabled = false; }
    }
    advanced.addEventListener('change', () => savePreference(advanced, 'advanced', advanced.checked, () => { advanced.checked = isAdvanced(); }, render));
    function preferenceRow(definition) {
      const prefs = ctx.preferences(id), supported = implementedPreferences.has(definition.id);
      const [title, description] = settingCopy[definition.id] ?? [definition.label ?? definition.id, 'Saved for compatibility; this setting is not available yet.'];
      const row = el('div', undefined, 'rule-row setting-row settings-option'), text = el('div', undefined, 'field-copy');
      const help = el('p', description, 'field-help'); help.id = `setting-help-${id}-${definition.id}`;
      let control;
      if (definition.id === 'startingChunk') {
        const chunk = ctx.world?.().chunks?.get(String(prefs.startingChunk));
        const name = chunk?.name ? (ctx.plain?.(chunk.name) ?? chunk.name) : 'starting flag';
        control = button(prefs.startingChunk ? `Edit ${isAdvanced() ? `${name} (${prefs.startingChunk})` : name}` : 'Choose chunk', () => { ctx.closeDialog?.(); ctx.startingChunk(); });
      }
      else if (definition.type === 'boolean') { control = input('checkbox'); control.checked = prefs[definition.id]; }
      else if (definition.type === 'enum') control = select(definition.options.map(value => ({ value, label: optionLabels[definition.id]?.[value] ?? value })), prefs[definition.id]);
      else control = input(definition.type === 'color' ? 'color' : 'text', prefs[definition.id]);
      control.setAttribute('aria-label', title); control.setAttribute('aria-describedby', help.id); control.id = `setting-${id}-${definition.id}`;
      const label = el('label', undefined, 'setting-title'); label.htmlFor = control.id; label.append(el('strong', title)); label.title = definition.description; text.append(label, help);
      control.disabled = !supported;
      if (!supported) text.append(el('span', 'Not available yet', 'coverage-badge'));
      if (definition.id !== 'startingChunk') control.addEventListener('change', () => savePreference(control, definition.id, definition.type === 'boolean' ? control.checked : control.value, () => {
        const value = ctx.preferences(id)[definition.id]; if (definition.type === 'boolean') control.checked = value; else control.value = value;
      }));
      row.append(text, control); return row;
    }
    function render() {
      const token = ++renderGeneration; miningSettings?.dispose?.(); woodcuttingSettings?.dispose?.(); bankingSettings?.dispose?.(); streamSafeRow?.dispose?.();
      rows.replaceChildren(); sectionHeadings.clear(); const query = search.value.trim().toLowerCase();
      clear.hidden = !query; content.dataset.searching = String(!!query); advanced.checked = isAdvanced();
      artworkStatus.hidden = !isAdvanced(); artworkStatus.textContent = artStatusText();
      datasetStatus.hidden = !isAdvanced(); datasetStatus.textContent = datasetStatusText();
      for (const [sectionId, node] of navButtons) node.setAttribute('aria-current', sectionId === selected && !query ? 'page' : 'false');
      const assigned = new Set(sections.flatMap(section => section.ids));
      const retained = settingDefinitions.filter(definition => definition.type !== 'object' && !assigned.has(definition.id) && !mapDisplayIds.has(definition.id));
      const available = [...activeSections, ...(ctx.supportsFeature?.('rsCatalogues') !== false && isAdvanced() && retained.length ? [{ id: 'retained', label: 'Older settings', ids: retained.map(definition => definition.id) }] : [])];
      let matches = 0;
      for (const section of available) {
        if (!query && section.id !== selected && section.id !== 'retained') continue;
        if (!query && section.id === 'retained' && selected !== 'panels') continue;
        const node = el('section', undefined, 'settings-section'), heading = el('h3', section.label);
        heading.tabIndex = -1; sectionHeadings.set(section.id, heading); node.append(heading); let count = 0;
        if (section.id === 'panels' && ctx.usage && (!query || 'count which windows i use usage counts privacy device'.includes(query))) {
          node.append(ctx.usage.settingsRow()); count++;
        }
        if (section.id === 'panels' && ctx.streamSafe && (!query || 'stream-safe mode hide private links feedback names browser'.includes(query))) {
          streamSafeRow = ctx.streamSafe.settingsRow(); node.append(streamSafeRow); count++;
        }
        for (const preferenceId of section.ids) {
          if (ctx.supportsFeature?.('rsCatalogues') === false && ['defaultChunkinfo', 'topButtons', 'allTasks', 'hideAchievements'].includes(preferenceId)) continue;
          const definition = settingDefinitions.find(item => item.id === preferenceId); if (!definition) continue;
          const copy = settingCopy[preferenceId] ?? [definition.label, definition.description];
          if (query && !`${section.label} ${copy.join(' ')} ${preferenceId}`.toLowerCase().includes(query)) continue;
          node.append(preferenceRow(definition)); count++;
        }
        if (section.id === 'map' && (!query || 'map display adjust chunk labels borders marker sizes default sticker colour high visibility show chunk ids roll numbers size chunk ids size sticker and flag size unlocked border colour'.includes(query))) {
          const row = el('div', undefined, 'rule-row settings-option'), text = el('div', undefined, 'field-copy');
          text.append(el('strong', 'Map display'), el('p', 'Adjust chunk labels, borders, marker sizes and sticker colour.', 'field-help'));
          row.append(text, button('Map display\u2026', () => { ctx.closeDialog?.(); ctx.mapDisplay(); })); node.append(row); count++;
        }
        if (section.id === 'map' && ctx.setupGuide && (!query || 'setup guide first time walkthrough roll style theme starting bank invite'.includes(query))) {
          const row = el('div', undefined, 'rule-row settings-option'), text = el('div', undefined, 'field-copy');
          text.append(el('strong', 'Setup guide'), el('p', 'Go through roll style, theme, your starting bank and the main buttons again.', 'field-help'));
          row.append(text, button('Setup guide\u2026', () => { if (ctx.canWrite?.() === false) return; ctx.closeDialog?.(); ctx.setupGuide(); })); node.append(row); count++;
        }
        if (section.id === 'map' && ctx.membersStart && (!query || 'ready for members group reset f2p starting bank havenhythe'.includes(query))) {
          const row = el('div', undefined, 'rule-row settings-option'), text = el('div', undefined, 'field-copy');
          text.append(el('strong', 'Ready for members'), el('p', 'Start fresh maps for the whole group while keeping your progress. Review starting banks and changes before saving.', 'field-help'));
          const start = button('Ready for members', () => { if (ctx.canWrite?.() === false) return; ctx.membersStart(); });
          start.disabled = ctx.membersStartAvailable?.() === false;
          row.append(text, start); node.append(row); count++;
        }
        if (section.id === 'time') {
          miningSettings = createMiningSettings(ctx, id, { query: query && !section.label.toLowerCase().includes(query) ? query : '', isCurrent: () => renderGeneration === token });
          if (!miningSettings.hidden) { node.append(miningSettings); count++; }
          woodcuttingSettings = createWoodcuttingSettings(ctx, id, { query: query && !section.label.toLowerCase().includes(query) ? query : '', isCurrent: () => renderGeneration === token });
          if (!woodcuttingSettings.hidden) { node.append(woodcuttingSettings); count++; }
          bankingSettings = createBankingSettings(ctx, id, { query: query && !section.label.toLowerCase().includes(query) ? query : '', isCurrent: () => renderGeneration === token });
          if (!bankingSettings.hidden) { node.append(bankingSettings); count++; }
          const estimates = createDeathSettings(ctx, id, { query: query && !section.label.toLowerCase().includes(query) ? query : '' });
          if (!estimates.hidden) { node.append(estimates); count++; }
        }
        if (section.id === 'rolling' && (!query || count)) {
          const footer = el('p', undefined, 'settings-rolling-footer'); footer.append(el('span', 'Which chunks can be rolled is shared by both of you: '), button('Chunk Rules', () => { ctx.closeDialog?.(); ctx.rulesDialog(); }, 'settings-text-link')); node.append(footer);
        }
        if (count) { rows.append(node); matches += count; }
      }
      if (!matches) rows.append(el('p', 'No matching settings.', 'empty-list'));
    }
    search.addEventListener('input', render);
    search.addEventListener('keydown', event => { if (event.key === 'Escape' && search.value) { event.preventDefault(); event.stopPropagation(); search.value = ''; content.dataset.mobileView = 'detail'; render(); search.focus?.(); } });
    render(); openDialog('Settings', content);
    const title = ctx.$?.('dialog-title'); if (title) title.append(el('span', `For ${owner.name}`, 'settings-owner'));
  }

  return { settings };
}
