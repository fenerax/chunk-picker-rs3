const $ = id => document.getElementById(id);
const ms = value => `${value.toFixed(2)} ms`;
function table(headers, rows) {
  const element = document.createElement('table'), head = element.createTHead().insertRow(), body = element.createTBody();
  for (const value of headers) { const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = value; head.append(cell); }
  for (const row of rows) { const line = body.insertRow(); for (const value of row) line.insertCell().textContent = String(value); }
  return element;
}
async function request(url, options) {
  const response = await fetch(url, options); if (!response.ok) throw new Error(`Request failed (${response.status}).`); return response.json();
}
async function refresh() {
  try {
    const data = await request('/api/admin/live-timings'); $('windows').replaceChildren();
    $('status').textContent = `${data.enabled ? 'Recording' : 'Disabled'} · ${data.writeFailures} persistence errors · Updated ${new Date().toLocaleTimeString()}`;
    for (const [window, rows] of Object.entries(data.windows)) {
      const title = document.createElement('h2'); title.textContent = window;
      const wrap = document.createElement('div'); wrap.className = 'table-wrap';
      wrap.append(table(['Action', 'Count', 'p50', 'p90', 'p99', 'Max', 'Cache hits', 'Coalesced', 'Calculator starts', 'Failed', 'Stage means'], rows.map(row => [row.action, row.count, ms(row.p50), ms(row.p90), ms(row.p99), ms(row.max), `${(row.cacheHitShare * 100).toFixed(1)}%`, row.coalesced, row.calculatorStarted, row.failed, Object.entries(row.stages).map(([name, s]) => `${name}: ${ms(s.totalMs / (s.count || 1))}`).join('; ')])));
      $('windows').append(title, wrap);
    }
    $('slowest').replaceChildren(table(['Action', 'Duration', 'Flags', 'Time'], data.slowest.map(event => [event.action, ms(event.durationMs), ['cached', 'coalesced', 'calculatorStarted', 'failed'].filter(key => event[key]).join(', ') || 'computed', new Date(event.time).toLocaleString()])));
    $('profile-status').textContent = data.profile.active ? `Recording until ${new Date(data.profile.deadline).toLocaleTimeString()}` : data.profile.stopping ? 'Finishing profiles…' : `Off · ${data.profile.failures} profile errors`;
    $('start').disabled = data.profile.active || data.profile.stopping; $('stop').disabled = !data.profile.active;
    $('profiles').replaceChildren();
    for (const file of data.profiles) { const li = document.createElement('li'), link = document.createElement('a'); link.href = `/api/admin/cpu-profiles?name=${encodeURIComponent(file.name)}`; link.textContent = `${file.name} (${file.bytes.toLocaleString()} bytes)`; li.append(link); $('profiles').append(li); }
  } catch (error) { $('status').textContent = error.message; }
}
async function profile(action) {
  try { await request('/api/admin/cpu-profiles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, seconds: Number($('seconds').value) }) }); await refresh(); }
  catch (error) { $('status').textContent = error.message; }
}
$('refresh').addEventListener('click', refresh); $('start').addEventListener('click', () => profile('start')); $('stop').addEventListener('click', () => profile('stop'));
await refresh(); setInterval(refresh, 10000);
