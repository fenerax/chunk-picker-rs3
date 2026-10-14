import { createNoteEditor } from './info-panels.mjs';

// Notes retain their player owner, including on the combined map.
export function createScreenChunkNotes(c) {
  function expansion(host, text, label, expanded = false, onToggle = () => {}) {
    const toggle = c.button(expanded ? 'Collapse note' : 'Expand note', () => {
      expanded = !expanded; paint(); onToggle(expanded);
    }, 'chunk-note-expand');
    function paint() {
      host.dataset.expanded = String(expanded);
      toggle.textContent = expanded ? 'Collapse note' : 'Expand note';
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.setAttribute('aria-label', `${toggle.textContent}: ${label}`);
      toggle.hidden = !expanded && !(text.scrollHeight > text.clientHeight + 1);
    }
    host.append(toggle); paint();
    let observer, disposed = false;
    requestAnimationFrame(() => {
      if (disposed || !host.isConnected) return;
      paint();
      if (typeof ResizeObserver === 'function') { observer = new ResizeObserver(paint); observer.observe(text); }
    });
    text.addEventListener('input', paint);
    return { paint, dispose() { disposed = true; observer?.disconnect(); } };
  }

  function chunkNote(id) {
    disposeChunkNotes();
    const draftKey = `${c.memberId}:${id}`, noteMember = c.memberId, original = c.member().notes?.[id] ?? '';
    const review = c.chunkDrafts.get(draftKey) ?? { revision: c.state.revision, original, value: original };
    const editor = createNoteEditor(c.panelContext, { label: `${c.member().name}’s note${c.chunkDrafts.has(draftKey) ? ' · unsaved draft' : ''}`, saveLabel: 'Save chunk note', payload: { type: 'set-note', memberId: noteMember, chunkId: id }, review, isCurrent: () => editor.isConnected && c.chunkId === id && c.memberId === noteMember, onChange: () => c.chunkDrafts.set(draftKey, review), onSaved: value => { if (c.chunkDrafts.get(draftKey)?.value === value) c.chunkDrafts.delete(draftKey); ownExpansion.paint(); } });
    editor.className = 'chunk-own-note'; editor.children[0].className = 'chunk-note';
    const text = editor.querySelector('textarea');
    const ownExpansion = expansion(editor, text, `${c.member().name}’s note`);
    const element = c.el('div', undefined, 'chunk-notes'), partners = c.el('div', undefined, 'chunk-partner-notes'), expanded = new Map();
    element.append(editor, partners);
    let signature, partnerExpansions = [];
    function refresh() {
      if (c.memberId !== noteMember || c.chunkId !== id) return;
      const owners = c.state.members.filter(owner => owner.id !== noteMember && owner.notes?.[id]?.trim());
      const next = JSON.stringify(owners.map(owner => [owner.id, owner.name, owner.notes[id]]));
      if (c.canWrite() === false) { text.value = c.member().notes?.[id] ?? ''; ownExpansion.paint(); }
      if (signature === next) return;
      signature = next;
      partnerExpansions.forEach(view => view.dispose()); partnerExpansions = [];
      partners.replaceChildren(...owners.map(owner => {
        const label = `${owner.name}’s note`, section = c.el('section', undefined, 'chunk-partner-note'), body = c.el('p', owner.notes[id], 'chunk-note-text');
        section.setAttribute('aria-label', label);
        section.append(c.el('h3', label, 'chunk-note-label'), body);
        partnerExpansions.push(expansion(section, body, label, expanded.get(owner.id), value => expanded.set(owner.id, value)));
        return section;
      }));
    }
    c.chunkNotes = { element, refresh, dispose() { ownExpansion.dispose(); partnerExpansions.forEach(view => view.dispose()); } }; refresh(); return element;
  }

  function refreshChunkNotes() {
    if (c.chunkNotes?.element.isConnected) c.chunkNotes.refresh();
  }
  function disposeChunkNotes() { c.chunkNotes?.dispose(); c.chunkNotes = null; }
  Object.assign(c, { chunkNote, refreshChunkNotes, disposeChunkNotes });
}
