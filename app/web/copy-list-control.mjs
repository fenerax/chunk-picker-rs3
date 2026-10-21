import { formatCopyList } from './copy-list-model.mjs';

export function createCopyListControl({ document, id, label, readList, complete = false, getClipboard = () => globalThis.navigator?.clipboard }) {
  const make = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const element = make('span', undefined, 'list-copy-control');
  const copy = make('button', 'Copy', 'list-copy-button');
  copy.type = 'button'; copy.id = id;
  copy.setAttribute('aria-label', label);
  copy.title = complete ? `${label} for Discord. Includes every filtered task.` : `${label} for Discord. Long lists end with …and N more.`;
  const status = make('output', '', 'list-copy-status');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  element.append(copy, status);

  const fallback = make('div', undefined, 'list-copy-fallback'); fallback.hidden = true;
  const help = make('label', 'Clipboard unavailable. Copy the selected text below.');
  help.htmlFor = `${id}-text`;
  const text = make('textarea'); text.id = help.htmlFor; text.readOnly = true; text.rows = 7;
  const actions = make('div', undefined, 'list-copy-actions');
  const select = make('button', 'Select all'), close = make('button', 'Close');
  select.type = close.type = 'button';
  const selectText = () => { text.focus(); text.select(); };
  select.addEventListener('click', selectText);
  close.addEventListener('click', () => { fallback.hidden = true; copy.focus(); });
  actions.append(select, close); fallback.append(help, text, actions);

  let generation = 0;
  const refresh = () => { generation++; copy.disabled = false; status.textContent = ''; fallback.hidden = true; };
  copy.addEventListener('click', async event => {
    event.preventDefault(); event.stopPropagation();
    const current = ++generation, list = formatCopyList({ ...readList(), ...(complete ? { limit: Infinity } : {}) });
    copy.disabled = true; status.textContent = ''; fallback.hidden = true;
    try {
      const clipboard = getClipboard();
      if (!clipboard?.writeText) throw new Error('Clipboard unavailable');
      await clipboard.writeText(list.text);
      if (current === generation) status.textContent = list.omittedCount ? `Copied · ${list.copiedCount} of ${list.count}` : 'Copied';
    } catch {
      if (current === generation) {
        text.value = list.text; fallback.hidden = false;
        status.textContent = 'Select text to copy'; selectText();
      }
    } finally { if (current === generation) copy.disabled = false; }
  });
  return { element, fallback, refresh };
}
