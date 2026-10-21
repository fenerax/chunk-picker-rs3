import { createNoteEditor } from './info-panels.mjs';

// Map-wide text stays separate from chunk notes, with one draft per player.
export function createScreenJournal(c) {
  const drafts = new Map();
  let view;

  function open() {
    const owner = c.member(), ownerId = owner.id, original = owner.journal ?? '';
    const editable = c.canWrite() && !c.sandbox.active;
    const review = (editable ? drafts.get(ownerId) : undefined) ?? { revision: c.state.revision, original, value: original };
    const content = c.el('div', undefined, 'map-journal form-stack'), partners = c.el('div', undefined, 'journal-partners');
    let generation;
    const current = () => c.dialogCurrent(generation) && c.memberId === ownerId && content.isConnected;
    const editor = createNoteEditor({ ...c.panelContext, canWrite: () => editable }, {
      label: `${owner.name}’s journal`, saveLabel: 'Save journal', payload: { type: 'set-journal', memberId: ownerId },
      review, maxLength: 10000, isCurrent: current,
      onChange: () => drafts.set(ownerId, review),
      onSaved: value => { if (drafts.get(ownerId)?.value === value) drafts.delete(ownerId); },
    });
    content.append(c.el('p', editable ? 'Notes for the whole map. Both players can read them. Up to 10,000 characters.' : 'Notes for the whole map. Both players can read them.', 'status-detail'), editor, partners);
    generation = c.openDialog('Map journal', content);
    view = { ownerId, review, text: editor.querySelector('textarea'), partners, current, editable };
    refresh();
  }

  function refresh() {
    for (const id of drafts.keys()) if (!c.state.members.some(owner => owner.id === id)) drafts.delete(id);
    if (!view?.current()) return;
    const { ownerId, review, text, partners, editable } = view;
    const owner = c.state.members.find(member => member.id === ownerId);
    if (!editable || !drafts.has(ownerId)) {
      text.value = review.value = review.original = owner.journal ?? '';
      review.revision = c.state.revision;
    }
    const owners = c.state.members.filter(member => member.id !== ownerId);
    const signature = JSON.stringify(owners.map(member => [member.id, member.name, member.journal]));
    if (view.signature === signature) return;
    view.signature = signature;
    partners.replaceChildren(...owners.map(member => {
      const section = c.el('section', undefined, 'journal-partner');
      section.append(c.el('h3', `${member.name}’s journal`), c.el('p', member.journal?.trim() ? member.journal : 'No journal entries yet.', member.journal?.trim() ? 'journal-text' : 'status-detail'));
      return section;
    }));
  }

  c.journal = { open, refresh };
  c.$('journal-open').addEventListener('click', open);
}
