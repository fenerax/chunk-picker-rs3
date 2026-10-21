const safe = value => String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, 140)
  .replace(/[\\`*_~|<>\[\]]/gu, '\\$&').replace(/@/gu, '@\u200b');

export function formatFinishLineSummary(model) {
  const lines = ['**F2P finish line · Draft**', 'Our editable goals before members.',
    ...model.members.map(member => `${safe(member.name)}: ${member.percent}% · ${member.done}/${member.total} done`),
    `Duo: ${model.duo.percent}% · ${model.duo.done}/${model.duo.total} done`];
  for (const group of model.groups) {
    if (!group.total) continue;
    lines.push(`**${safe(group.label)} · ${group.done}/${group.total} duo done**`);
    for (const item of group.items.filter(item => item.enabled && !item.duo.done)) {
      lines.push(`${safe(item.label)}: ${safe(item.status)}`);
    }
  }
  let text = '';
  for (const line of lines) {
    if (text.length + line.length + 1 > 1920) return `${text}\n…See Info → F2P finish line for the full list.`;
    text += `${text ? '\n' : ''}${line}`;
  }
  return text;
}

export function createFinishLineCopy(context, model, getClipboard = () => globalThis.navigator?.clipboard) {
  const { el, button } = context, root = el('div', undefined, 'finish-line-copy');
  const status = el('output', '', 'list-copy-status'); status.setAttribute('role', 'status');
  const fallback = el('div', undefined, 'list-copy-fallback'); fallback.hidden = true;
  const text = el('textarea'); text.id = 'finish-line-copy-text'; text.readOnly = true; text.rows = 7;
  const label = el('label', 'Clipboard unavailable. Copy the selected text below.'); label.htmlFor = text.id;
  const select = () => { text.focus(); text.select(); };
  const copy = button('Copy for Discord', async () => {
    copy.disabled = true; fallback.hidden = true; status.textContent = '';
    const summary = formatFinishLineSummary(model);
    try {
      const clipboard = getClipboard();
      if (!clipboard?.writeText) throw new Error('Clipboard unavailable');
      await clipboard.writeText(summary); status.textContent = 'Copied';
    } catch {
      text.value = summary; fallback.hidden = false; status.textContent = 'Select text to copy'; select();
    } finally { copy.disabled = false; }
  }, 'list-copy-button');
  const actions = el('div', undefined, 'list-copy-actions');
  actions.append(button('Select all', select), button('Close', () => { fallback.hidden = true; status.textContent = ''; copy.focus(); }));
  fallback.append(label, text, actions); root.append(copy, status, fallback);
  return root;
}
