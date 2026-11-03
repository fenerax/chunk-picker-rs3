// Synthetic DOM fixture for the row layout, using the real How/claim/duo controls.
export const taskRowLayoutFixture = `
import { appendTaskHow } from '/task-how.mjs';
import { appendTaskClaim } from '/task-claims.mjs';
import { createDuoTaskView } from '/duo-task-view.mjs';
const el = (tag, text, cls) => Object.assign(document.createElement(tag), { ...(text ? { textContent: text } : {}), ...(cls ? { className: cls } : {}) });
const button = (text, action, cls) => { const node = el('button', text, cls); node.type = 'button'; node.addEventListener('click', action); return node; };
const task = { id: 'synthetic-safe', label: '(Furniture Plans) Unlock furniture plans: Safe', category: 'Extra', status: 'available', level: 1 };
const state = { revision: 1, members: [{ id: 'one', name: 'Player 2' }, { id: 'two', name: 'Explorer' }], taskClaims: {} };
const proof = { proofStatus: 'complete', root: 'goal', nodes: { goal: { kind: 'task', taskLabel: 'Unlock furniture plans: Safe', allOf: ['supply'] }, supply: { kind: 'item-source', sourceKind: 'shop', sourceName: 'the furniture shop', subjectId: 'Furniture plans', allOf: [] } } };
const appendHow = row => appendTaskHow(row, task, { document, button, scope: () => 'fixture', load: async () => proof });
const appendClaim = host => appendTaskClaim({ document, host, task, getState: () => state, getMemberId: () => 'one', actingForMember: () => true, canEdit: () => true, command: async () => {}, showError: error => { throw error; } });
const icon = name => { const node = el('span', undefined, 'icon icon-' + name); node.setAttribute('aria-hidden', 'true'); return node; };
const taskIcon = body => { const node = el('img', undefined, 'task-icon'); node.src = '/placeholder-art/item.svg'; node.alt = ''; body.append(node); };
const section = el('section'); document.querySelector('#active-tasks').append(section);
function solo(id, { completed = false, readOnly = false, how = true, form = false } = {}) {
  const row = el('div', undefined, 'task-row'); row.id = id; row.dataset.completed = String(completed);
  const checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.checked = completed; checkbox.setAttribute('aria-label', 'Mark synthetic task done');
  const body = el('div', undefined, 'task-body'), content = el('div'); taskIcon(body);
  content.append(button(task.label, () => {}, 'task-label-button'), el('span', 'Level 1', 'task-meta'));
  if (completed) content.append(el('span', 'Done by Player 2', 'task-meta')); else appendClaim(content);
  body.append(content); row.append(readOnly ? el('span', completed ? 'Done' : 'Not done', 'task-completion-status') : checkbox, body);
  if (how) appendHow(row);
  const why = button('', () => {}, 'icon-button task-why'); why.setAttribute('aria-label', 'Why is this task here?'); why.append(icon('why'));
  const wiki = el('a', undefined, 'icon-button'); wiki.href = '#wiki'; wiki.setAttribute('aria-label', 'Open RuneScape Wiki'); wiki.append(icon('wiki'));
  const backlog = button('', () => {}, 'icon-button task-backlog'); backlog.setAttribute('aria-label', 'Backlog task'); backlog.append(icon('backlog'));
  row.append(why, wiki, backlog);
  if (readOnly) backlog.hidden = true;
  if (form) { const form = el('form', undefined, 'backlog-form'); const reason = el('input'); reason.placeholder = 'Reason for backlogging'; form.append(reason, button('Backlog', () => {}), button('Cancel', () => {})); row.append(form); }
  section.append(row); return row;
}
solo('solo');
const open = solo('open'); open.querySelector('.task-how').click();
solo('completed', { completed: true, readOnly: true, how: false });
solo('readonly', { readOnly: true });
const duo = createDuoTaskView({ document, getState: () => state, getSelectedMember: () => 'one', getStorage: () => null,
  command: async () => {}, backlog: () => {}, showTask: () => {}, appendWhy: appendHow, appendIcon: taskIcon,
  actingForMember: () => true, showError: error => { throw error; } });
const duoRow = duo.row({ task, memberIds: ['one', 'two'], label: 'Player 2 and Explorer', facts: { group: false, personal: false, completedBy: [] } });
duoRow.id = 'duo'; section.append(duoRow);
solo('backlogged', { how: false, form: true });
await document.fonts.ready;
document.documentElement.dataset.fixtureReady = 'true';
`;
