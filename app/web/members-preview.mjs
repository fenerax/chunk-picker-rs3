import { appendPreviewTasks } from './preview-additions.mjs';

export function createMembersPreview(c) {
  async function open() {
    if (!c.canWrite()) return;
    const content = c.el('div', undefined, 'form-stack');
    const generation = c.openDialog('What would membership add?', content);
    if (c.sandbox?.active) {
      content.append(c.el('p', 'Leave Sandbox to preview membership on your saved map.', 'status-detail')); return;
    }
    if (c.state.rules?.['content.f2p'] === false) {
      content.append(c.el('p', 'Your group is already members.', 'status-detail')); return;
    }
    if (c.registry && !c.registry.get('content.f2p')) {
      content.append(c.el('p', 'This dataset does not support membership comparisons.', 'status-detail')); return;
    }
    const memberId = c.memberId, revision = c.state.revision;
    const current = () => c.dialogCurrent(generation) && c.canWrite() && !c.sandbox?.active;
    const owner = c.state.members.find(member => member.id === memberId);
    content.append(c.el('p', `Compare ${owner.name}’s current map with membership. This preview keeps your chunks, rules and progress and does not start the members transition.`, 'status-detail'));
    const outcome = c.el('div', undefined, 'unlock-preview'), status = c.el('p', 'Working out what membership would add…', 'status-detail');
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    outcome.setAttribute('aria-busy', 'true'); content.append(status, outcome);
    try {
      const value = await c.api('/api/sandbox/evaluate', { memberId, baseRevision: revision, changes: { members: true } });
      if (!current()) return;
      if (c.memberId !== memberId || c.state.revision !== revision || value.memberId !== memberId || value.stateRevision !== revision) {
        throw new Error('Your saved map changed. Recalculate to compare the latest map.');
      }
      status.textContent = '';
      appendPreviewTasks(c, outcome, value.delta.tasksAdded, { expandable: true });
      for (const [key, label] of [['items', 'Items'], ['areas', 'Areas'], ['sections', 'Sections'], ['objects', 'Objects'], ['npcs', 'NPCs'], ['monsters', 'Monsters'], ['shops', 'Shops']]) {
        const rows = value.delta[`${key}Added`] ?? [];
        if (!rows.length) continue;
        const names = rows.map(row => {
          const id = typeof row === 'string' ? row : row.name;
          return c.plain(key === 'areas' ? c.world.areas.get(id)?.name ?? id : id);
        });
        outcome.append(c.details(`${label} (${rows.length})`, c.list(names)));
      }
      outcome.append(c.el('p', 'Only additions supported by this dataset and your current access and requirements are shown. Completed and backlogged tasks stay excluded, as in chunk Preview.', 'status-detail'));
    } catch (error) {
      if (!current()) return;
      status.textContent = '';
      outcome.replaceChildren(c.el('p', error.message || String(error), 'error'), c.button('Recalculate', open));
    } finally { if (current()) outcome.setAttribute('aria-busy', 'false'); }
  }
  return { open };
}
