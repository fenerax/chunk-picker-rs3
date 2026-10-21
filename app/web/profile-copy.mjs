const safe = value => String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, 120)
  .replace(/[\\`*_~|<>\[\]]/gu, '\\$&').replace(/@/gu, '@\u200b');
const number = value => value == null ? 'unknown' : String(value);

/** A short, single-message summary. Only recorded personal facts are exported. */
export function formatProfileSummary(model) {
  const { header, skills, tasks, quests, achievements, gear } = model;
  const lines = [
    `**${safe(header.name)} · Profile**${header.runescapeName ? ` (${safe(header.runescapeName)})` : ''}`,
    `Chunks unlocked: ${header.unlockedCount}`,
    `Total level: ${number(skills.totalLevel)} · Combat: ${number(skills.combatLevel)}`,
    `Levels: ${skills.knownCount}/${skills.totalCount} recorded${skills.lastSyncAt ? ` · Last synced: ${safe(skills.lastSyncAt.slice(0, 10))}` : ''}`,
    `Completed tasks: ${tasks.completedCount} · ${tasks.categories.map(row => `${safe(row.category)} ${row.completed}`).join(' · ')}`,
    `Quests: ${quests.completed}/${number(quests.total)} recorded complete`,
    `Diaries / achievements: ${achievements.ticked} ticked in the picker`,
    gear.totalRecorded == null ? 'Gear: recorded details not loaded' : `Gear: ${gear.totalRecorded} items recorded obtained`,
  ];
  let text = '';
  for (const line of lines) {
    if (text.length + line.length + 1 > 1980) return `${text}\n…See Profile for more.`;
    text += `${text ? '\n' : ''}${line}`;
  }
  return text;
}

// Match the existing Copy controls, including the selected-text recovery path.
export function createProfileCopy(context, model, getClipboard = () => globalThis.navigator?.clipboard) {
  const { el, button } = context, root = el('div', undefined, 'profile-copy');
  const status = el('output', '', 'list-copy-status'); status.setAttribute('role', 'status');
  const fallback = el('div', undefined, 'list-copy-fallback'); fallback.hidden = true;
  const text = el('textarea'); text.id = 'profile-copy-text'; text.readOnly = true; text.rows = 7;
  const label = el('label', 'Clipboard unavailable. Copy the selected text below.'); label.htmlFor = text.id;
  const select = () => { text.focus(); text.select(); };
  const actions = el('div', undefined, 'list-copy-actions');
  const copy = button('Copy summary', async () => {
    copy.disabled = true; status.textContent = ''; fallback.hidden = true;
    const summary = formatProfileSummary(model);
    try {
      const clipboard = getClipboard();
      if (!clipboard?.writeText) throw new Error('Clipboard unavailable');
      await clipboard.writeText(summary); status.textContent = 'Copied';
    } catch {
      text.value = summary; fallback.hidden = false; status.textContent = 'Select text to copy'; select();
    } finally { copy.disabled = false; }
  }, 'list-copy-button');
  copy.setAttribute('aria-label', `Copy ${model.header.name}’s profile summary`);
  actions.append(button('Select all', select), button('Close', () => { fallback.hidden = true; copy.focus(); }));
  fallback.append(label, text, actions); root.append(copy, status, fallback);
  return root;
}
