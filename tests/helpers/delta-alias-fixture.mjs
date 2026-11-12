import { fixture, first, now, taskCatalogue } from './owned-format2-fixture.mjs';

export const alias = 'first-alias';
const aliasRow = { id: alias, label: 'Synthetic alias row', category: 'Synthetic' };

export function deltaAliasCases() {
  return ['alias tick', 'alias-only caller catalogue row', 'alias and canonical saved rows',
    'mixed canonical and alias tick', 'Undo restoring a historical alias'].map(name => {
    const built = fixture();
    const catalogue = name === 'alias-only caller catalogue row'
      ? new Map([[alias, { ...aliasRow }]]) : taskCatalogue;
    if (['alias and canonical saved rows', 'mixed canonical and alias tick', 'Undo restoring a historical alias'].includes(name)) {
      built.state.tasks.push({ ...aliasRow });
    }
    let command = { type: 'tick-active-tasks', memberId: 'member-1',
      taskIds: name === 'mixed canonical and alias tick' ? [first, alias] : [alias] };
    if (name === 'Undo restoring a historical alias') {
      // Valid imported History can contain an alias on an inverse's before side
      // even when current progress is canonical. Full validation leaves this
      // state unchanged, then normalizes the restored fact during Undo.
      built.state.revision = 1;
      built.state.members[0].taskStatus = {};
      built.state.history = [{ id: 'revision-1', revision: 1, type: 'tick-active-tasks', at: now(),
        command: { type: 'tick-active-tasks', memberId: 'member-1', taskIds: [alias], ticked: 1 },
        undo: { memberChanges: [{ id: 'member-1', changes: [{ path: ['taskStatus', alias], kind: 'value',
          before: { exists: true, value: { challengeCompleted: true } }, after: { exists: false } }] }] } }];
      command = { type: 'undo' };
    }
    return { name, ...built, catalogue, command, accepted: name !== 'alias tick' };
  });
}
