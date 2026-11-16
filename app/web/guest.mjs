import { createGuestSave } from './guest-save.mjs';

const $ = id => document.getElementById(id);
let token, expiresAt, save, backup, chunks = [], rules = [], pool, chosen, tasks = [], busy = false, stale = false;
const member = () => backup?.state.members[0];
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function controls() {
  $('picker').setAttribute('aria-busy', String(busy));
  $('import-open').disabled = $('import').disabled = busy || stale || !save;
  for (const button of document.querySelectorAll('[data-play], #rules input, #rules select, #choices button')) button.disabled = busy || stale || !backup;
  if (backup && !busy && !stale) {
    $('roll').disabled = !pool?.eligible?.length || !!member().pendingRoll.length;
    $('roll-two').disabled = (pool?.eligible?.length ?? 0) < 2 || !!member().pendingRoll.length;
    for (const id of ['unlock', 'select', 'lock', 'save-note']) $(id).disabled = !chosen;
  }
}
async function request(operation, extra = {}) {
  const result = await fetch('/guest/api/run', { method: 'POST', credentials: 'omit',
    headers: { 'Content-Type': 'application/json', 'X-Guest-Token': token },
    body: JSON.stringify({ operation, ...(operation === 'new' ? {} : { backup }), ...extra }), signal: AbortSignal.timeout(35000) });
  const body = await result.json();
  if (!result.ok) throw new Error(`${body.message}${result.headers.get('Retry-After') ? ` Try again in ${result.headers.get('Retry-After')} seconds.` : ''}`);
  return body;
}
async function perform(operation) {
  if (busy) return;
  busy = true; controls();
  try { await operation(); }
  catch (error) { status(error.message || 'Guest action failed. Your browser save is unchanged; reload and try again.', true); }
  finally { busy = false; controls(); }
}
async function commit(value) {
  const write = () => save.commit(value);
  if (navigator.locks) await navigator.locks.request(save.key, write);
  else throw new Error('This browser cannot safely save guest progress across tabs. Use a current browser with Web Locks support.');
  backup = value;
}
function applyResult(result) {
  pool = result.pool;
  if (result.chunks) { chunks = result.chunks; rules = result.rules; renderSearch(); }
  if (!chosen) chosen = chunks.find(chunk => chunk.id === member()?.unlocked[0])?.id ?? chunks.find(chunk => chunk.id === '12850')?.id ?? chunks[0]?.id;
  renderMap(); renderChoices(); renderRules();
}
async function command(value) {
  if (stale || save.changed()) throw new Error('This save changed in another tab. Reload before making another change.');
  status('Applying your change…');
  const result = await request('command', { command: { ...value, ...(value.type === 'set-rule' || value.type === 'undo' ? {} : { memberId: member().id }) } });
  await commit(result.backup);
  tasks = []; renderTasks(); $('how').hidden = true;
  applyResult(result);
  status(`Saved in this browser · revision ${backup.state.revision}. Calculate tasks to refresh your list.`);
}
function button(label, action) {
  const node = document.createElement('button'); node.textContent = label; node.dataset.play = '';
  node.addEventListener('click', () => perform(action)); return node;
}
function renderSearch() {
  $('chunks').replaceChildren(...chunks.map(chunk => { const option = document.createElement('option'); option.value = chunk.id; option.label = chunk.label; return option; }));
}
function renderMap() {
  const center = chunks.find(chunk => chunk.id === chosen);
  if (!center || !backup) return;
  const lookup = new Map(chunks.map(chunk => [`${chunk.x}:${chunk.y}`, chunk]));
  const eligible = new Set((pool?.eligible ?? []).map(chunk => chunk.id));
  const cells = [];
  for (let y = center.y - 4; y <= center.y + 4; y++) for (let x = center.x - 4; x <= center.x + 4; x++) {
    const chunk = lookup.get(`${x}:${y}`);
    if (!chunk) { const empty = document.createElement('span'); empty.className = 'empty'; cells.push(empty); continue; }
    const unlocked = member().unlocked.includes(chunk.id);
    const node = button(chunk.id, async () => { chosen = chunk.id; renderMap(); controls(); });
    node.className = [unlocked && 'unlocked', eligible.has(chunk.id) && 'eligible', chosen === chunk.id && 'chosen'].filter(Boolean).join(' ');
    node.setAttribute('aria-label', `${chunk.label}, chunk ${chunk.id}, ${unlocked ? 'unlocked' : eligible.has(chunk.id) ? 'rollable' : 'locked'}`);
    node.setAttribute('aria-pressed', String(chosen === chunk.id));
    node.title = node.getAttribute('aria-label'); cells.push(node);
  }
  $('map').replaceChildren(...cells);
  $('selection').textContent = `${center.label === chosen ? 'Chunk' : center.label} · ${chosen} · ${member().unlocked.includes(chosen) ? 'Unlocked' : 'Locked'} · ${pool?.eligible?.length ?? 0} roll candidates`;
  $('note').value = member().notes?.[chosen] ?? '';
}
function renderChoices() {
  $('choices').replaceChildren(...member().pendingRoll.map(chunkId => button(`Choose ${chunkId}`, () => command({ type: 'unlock-selection', chunkId }))));
  if (member().pendingRoll.length) $('choices').append(button('Pick for me', () => command({ type: 'pick-for-me' })), button('Cancel roll', () => command({ type: 'cancel-roll' })));
}
function renderRules() {
  $('rules').replaceChildren(...rules.filter(rule => !rule.id.startsWith('access.shared') && !rule.id.startsWith('completion.shared') && !rule.id.startsWith('supplies.shared')).map(rule => {
    const label = document.createElement('label'), name = document.createElement('span'); name.textContent = rule.label ?? rule.id; label.title = rule.description ?? ''; label.append(name);
    const control = document.createElement(rule.type === 'enum' ? 'select' : 'input');
    const value = Object.hasOwn(backup.state.rules, rule.id) ? backup.state.rules[rule.id] : rule.default;
    if (rule.type === 'enum') for (const option of rule.options) { const node = document.createElement('option'); node.value = option; node.textContent = option; control.append(node); }
    else control.type = rule.type === 'boolean' ? 'checkbox' : rule.type === 'number' ? 'number' : 'text';
    if (rule.type === 'boolean') control.checked = value; else control.value = value;
    control.addEventListener('change', () => perform(async () => {
      await command({ type: 'set-rule', ruleId: rule.id, value: rule.type === 'boolean' ? control.checked : rule.type === 'number' ? Number(control.value) : control.value });
    }).finally(() => { renderRules(); controls(); }));
    label.append(control); return label;
  }));
}
function renderTasks() {
  const query = $('task-filter').value.toLowerCase();
  const visible = tasks.filter(task => `${task.category} ${task.label}`.toLowerCase().includes(query));
  $('task-summary').textContent = tasks.length ? `${visible.length} of ${tasks.length} tasks · revision ${backup.state.revision}` : 'Calculate tasks for your current map.';
  // Bound DOM work; filtering can find any task in the complete result.
  $('tasks').replaceChildren(...visible.slice(0, 200).map(task => {
    const row = document.createElement('article'); row.className = 'task';
    const title = document.createElement('div'); title.className = 'task-title';
    const label = document.createElement('label'), check = document.createElement('input'); check.type = 'checkbox'; check.dataset.play = ''; check.checked = !!task.completed; check.disabled = busy || stale;
    check.addEventListener('change', () => perform(async () => { await command({ type: 'set-task-status', taskId: task.id, challengeCompleted: check.checked }); }).finally(() => { check.checked = !!task.completed; }));
    label.append(check, document.createTextNode(` ${task.label}`)); title.append(label, button('How?', async () => {
      status('Building the task explanation…');
      const result = await request('how', { taskId: task.id });
      const proof = result.how;
      const content = document.createElement('ol'), visited = new Set();
      function visit(id, depth = 0) {
        if (visited.has(id) || depth > 30) return;
        visited.add(id); const node = proof.nodes?.[id]; if (!node) return;
        for (const child of node.allOf ?? []) visit(child, depth + 1);
        const item = document.createElement('li'); item.textContent = node.label; content.append(item);
      }
      visit(proof.root); $('how-content').replaceChildren(content); $('how').hidden = false; $('how').scrollIntoView({ block: 'nearest' }); status('Explanation ready. Your save has not changed.');
    }));
    const detail = document.createElement('p'); detail.textContent = `${task.category} · ${task.status}. ${task.explanation ?? ''}`;
    row.append(title, detail); return row;
  }));
  if (visible.length > 200) { const message = document.createElement('p'); message.textContent = 'Showing the first 200 matches. Filter by name or skill to narrow the list.'; $('tasks').append(message); }
}
$('search-form').addEventListener('submit', event => {
  event.preventDefault(); const query = $('search').value.trim().toLowerCase();
  const chunk = chunks.find(chunk => chunk.id === query) ?? chunks.find(chunk => chunk.label.toLowerCase() === query)
    ?? chunks.find(chunk => chunk.label.toLowerCase().includes(query));
  if (!chunk) { status('No matching chunk. Try its numeric ID.', true); return; }
  chosen = chunk.id; renderMap(); controls();
});
for (const [id, type, extra] of [['unlock', 'set-chunk', { status: 'unlocked' }], ['select', 'set-chunk', { status: 'selected' }], ['lock', 'set-chunk', { status: 'locked' }],
  ['roll', 'roll', { count: 1 }], ['roll-two', 'roll', { count: 2 }], ['undo', 'undo', {}], ['save-note', 'set-note', {}]]) {
  $(id).addEventListener('click', () => perform(() => command({ type, ...extra,
    ...(['set-chunk', 'set-note'].includes(type) ? { chunkId: chosen } : {}), ...(type === 'set-note' ? { note: $('note').value } : {}) })));
}
$('load-tasks').addEventListener('click', () => perform(async () => { status('Calculating tasks…'); const result = await request('tasks'); tasks = result.tasks; renderTasks(); status('Tasks ready. Progress is saved only in this browser.'); }));
$('task-filter').addEventListener('input', renderTasks);
$('close-how').addEventListener('click', () => { $('how').hidden = true; });
$('export').addEventListener('click', () => { try {
  const url = URL.createObjectURL(new Blob([save.exportText()], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'chunk-picker-guest.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
} catch (error) { status(error.message, true); } });
$('import-open').addEventListener('click', () => $('import').click());
$('import').addEventListener('change', () => perform(async () => {
  const file = $('import').files[0]; if (!file) return;
  if (file.size > 2 * 1024 ** 2 - 4096) throw new Error('This guest save is too large. Keep it for import after signing in.');
  const incoming = save.parseImport(await file.text());
  if (!confirm('Replace this browser’s guest save with the selected file? Download your current save first if you want to keep it.')) return;
  const result = await request('load', { backup: incoming }); await commit(result.backup); tasks = []; chosen = undefined; applyResult(result); renderTasks(); status('Imported and saved in this browser.');
}).finally(() => { $('import').value = ''; }));
$('reload').addEventListener('click', () => location.reload());
window.addEventListener('storage', event => { if (save && (event.key === save.key || event.key === null)) { stale = true; controls(); status('This save changed in another tab. Reload before making another change.', true); } });
await perform(async () => {
  let previousToken;
  try { previousToken = sessionStorage.getItem('rs3:guest-admission'); } catch { /* Save storage has its own visible failure below. */ }
  const response = await fetch('/guest/api/session', { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json', ...(previousToken ? { 'X-Guest-Token': previousToken } : {}) }, body: '{}' });
  const session = await response.json(); if (!response.ok) throw new Error(session.message);
  ({ token, expiresAt } = session);
  try { sessionStorage.setItem('rs3:guest-admission', token); } catch { /* Reopening can obtain another bounded admission. */ }
  save = createGuestSave(localStorage, session.dataset);
  $('export').disabled = false;
  backup = save.load();
  const result = await request(backup ? 'load' : 'new');
  if (!backup) await commit(result.backup);
  applyResult(result); renderTasks(); status(`Saved only in this browser. Guest access lasts until ${new Date(expiresAt).toLocaleTimeString()}; reload afterward to resume.`);
});
