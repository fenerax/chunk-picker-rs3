import { playerControlSkills, validateControlLevel } from '../core/player-controls.mjs';
import { isCustomTask } from './custom-tasks-model.mjs';

export function createScreenCustomTasks(c) {
  function customTaskDialog(task) {
    if (!c.canWrite() || c.sandbox.active) return;
    const saved = task && c.state.tasks.find(row => row.id === task.id);
    if (task && (!saved || !isCustomTask(saved))) return;
    const revision = c.state.revision, stack = c.el('form', undefined, 'form-stack');
    const label = c.input('text', saved?.label ?? ''); label.required = true;
    const skill = c.select([{ value: '', label: 'None' }, ...(c.supportsFeature?.('training') === false ? [] : playerControlSkills.map(value => ({ value, label: value })))], saved?.skill ?? '');
    const level = c.input('number', saved?.level ?? ''); level.min = '1'; level.max = '120'; level.step = '1';
    const assignment = c.select([{ value: 'both', label: 'Both' }, ...c.state.members.map(member => ({ value: member.id, label: member.name }))], saved?.memberIds?.length === 1 ? saved.memberIds[0] : 'both');
    const error = c.el('p', '', 'status-detail'); error.setAttribute('role', 'alert'); error.hidden = true;
    const syncLevel = () => { level.disabled = !skill.value; if (!skill.value) level.value = ''; };
    skill.addEventListener('change', syncLevel); syncLevel();
    const save = c.el('button', saved ? 'Save changes' : 'Add task', 'primary-action'); save.type = 'submit';
    stack.append(c.field('Task description', label), ...(c.supportsFeature?.('training') === false ? [] : [c.field('Skill (optional)', skill), c.field('Level (optional)', level)]), c.field('Assigned to', assignment), error, save);
    let generation;
    const current = () => c.canWrite() && !c.sandbox.active && c.dialogCurrent(generation);
    stack.addEventListener('submit', async event => {
      event.preventDefault(); if (!current() || save.disabled) return;
      error.hidden = true;
      try {
        const description = label.value.trim(); if (!description) throw new Error('Enter a task description.');
        const fields = { label: description, ...(skill.value ? { skill: skill.value } : {}),
          ...(level.value ? { level: Number(level.value) } : {}),
          ...(assignment.value === 'both' ? {} : { memberIds: [assignment.value] }) };
        if (fields.level !== undefined) validateControlLevel(fields.level);
        save.disabled = true;
        await c.command(saved ? { type: 'update-task', taskId: saved.id, task: fields }
          : { type: 'add-task', task: { id: `custom:${c.browserUUID()}`, category: skill.value || 'Custom', ...fields } }, revision, undefined, current, undefined, () => { if (current()) c.closeDialog(generation); });
        c.closeDialog(generation);
      } catch (failure) { if (current()) { error.textContent = failure.status === 409 ? 'Another save arrived first. Close this form and reopen the task to review its latest details.' : failure.message; error.hidden = false; save.disabled = false; } }
    });
    if (saved) stack.append(c.button('Delete task…', () => c.deleteCustomTaskDialog(saved), 'danger-link'));
    generation = c.openDialog(saved ? 'Edit custom task' : 'Add custom task', stack);
    label.focus?.();
  }

  function deleteCustomTaskDialog(task) {
    if (!c.canWrite() || c.sandbox.active) return;
    const saved = c.state.tasks.find(row => row.id === task.id); if (!isCustomTask(saved)) return;
    const revision = c.state.revision, stack = c.el('div', undefined, 'form-stack');
    stack.append(c.el('p', `Delete “${c.plain(saved.label)}”?`), c.el('p', 'This removes the task and its checks for both players. Undo brings them back.', 'status-detail'));
    let generation;
    const current = () => c.canWrite() && !c.sandbox.active && c.dialogCurrent(generation);
    const confirm = c.button('Delete task', async () => {
      if (!current() || confirm.disabled) return;
      confirm.disabled = true;
      try { await c.command({ type: 'delete-task', taskId: saved.id }, revision, undefined, current, undefined, () => { if (current()) c.closeDialog(generation); }); c.closeDialog(generation); }
      catch (error) { if (current()) { confirm.disabled = false; if (error.status === 409) error.message = 'Another save arrived first. Close this confirmation and reopen the task to review its latest details.'; c.showError(error); } }
    }, 'danger-link');
    stack.append(confirm, c.button('Cancel', () => c.closeDialog(generation)));
    generation = c.openDialog('Delete custom task', stack);
  }

  function appendCustomTaskEdit(content, task) {
    if (!isCustomTask(task) || !c.canWrite()) return;
    const edit = c.button('Edit task', () => c.customTaskDialog(task), 'custom-task-edit');
    edit.setAttribute('aria-label', `Edit custom task ${c.plain(task.label)}`);
    edit.disabled = c.sandbox.active; content.append(edit);
  }
  Object.assign(c, { customTaskDialog, deleteCustomTaskDialog, appendCustomTaskEdit });
}
