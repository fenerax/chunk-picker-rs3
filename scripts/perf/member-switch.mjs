// Public/synthetic-only member-switch breakdown. No existing saves are read.
// node scripts/perf/member-switch.mjs --companion <scale-dataset dir> --out <report.json>
// Add --before <local START tree> --after <local changed tree> --pairs 7 for AB/BA runs.
// Each observation owns a fresh server (process calculators, 3 GiB heap), save,
// and Chromium. Output hashes exclude only cache timing metadata. RSS samples
// include the server and all descendants, sampled externally every 50 ms.
import { fork } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { openChrome, until, stopChild } from './cdp.mjs';
const opt = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1]; };
const here = fileURLToPath(import.meta.url);
if (process.argv.includes('--help')) {
  console.log('node scripts/perf/member-switch.mjs --companion <synthetic pack directory> --out <report.json> [--before <START tree> --after <candidate tree> --pairs 7 --scenario switch|unlock-running|unlock-idle --dwell-ms 12000 --interrupt-ms 800 --chrome /usr/bin/chromium]');
  process.exit(0);
}
const load = (root, file) => import(pathToFileURL(path.join(root, file)).href);
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
if (process.argv.includes('--child')) {
  let app;
  try {
    const root = opt('root');
    const { selectedDataset } = await load(root, 'app/dataset-runtime.mjs');
    if (!selectedDataset.status().version.includes('synthetic')) throw new Error('Use a generated synthetic companion.');
    const { createGroupState } = await load(root, 'app/core/state.mjs');
    const { loadDatasetInputs } = await load(root, 'app/dataset-bootstrap.mjs');
    const input = await loadDatasetInputs(selectedDataset);
    const definitions = JSON.parse(input.definitionBytes.toString());
    const chunks = Object.keys(definitions.chunks).filter(id => /^[1-9]\d*$/.test(id));
    // Different ownership sets exercise both unlocked and locked task rows.
    const members = selectedDataset.gameDefaults.members.map((owner, index) => ({ ...owner,
      unlocked: chunks.filter((_, i) => i % 9 === index), preferences: { advanced: false } }));
    const state = createGroupState(members);
    const { createServer } = await load(root, 'app/server.mjs');
    const start = performance.now();
    app = await createServer({ dataDir: opt('scratch'), port: 0, host: '127.0.0.1', initialState: state,
      predictionPrewarm: false, gameDataDir: path.join(opt('scratch'), 'absent-game'),
      mapAssetsDir: path.join(opt('scratch'), 'absent-map'), terrainAssetsDir: path.join(opt('scratch'), 'absent-terrain') });
    await app.listen();
    process.send({ ready: true, inviteUrl: app.inviteUrl, members: members.map(row => row.id), startupMs: performance.now() - start });
    process.on('message', async message => { if (message === 'stop') { await app.close(); process.exit(0); } });
    process.once('disconnect', async () => { await app.close(); process.exit(0); });
  } catch (error) { console.error(error.stack); await app?.close(); process.exit(1); }
} else {
  if (!opt('companion') || !opt('out')) throw new Error('Pass --companion <synthetic pack directory> and --out <report.json>.');
  const companion = path.resolve(opt('companion'));
  const receipt = JSON.parse(await readFile(path.join(companion, 'companion.json'), 'utf8'));
  const environment = { ...process.env, RS3_DATASET: 'duo-legacy', RS3_DATASET_PROFILE: path.join(companion, receipt.profile.path),
    RS3_DATASET_PROFILE_SHA256: receipt.profile.sha256, RS3_PACKS_DIR: path.join(companion, 'packs'),
    RS3_PACK_SELECTION: path.join(companion, 'selection.json'), RS3_TASK_WORKER_MODE: 'process', NODE_OPTIONS: '--max-old-space-size=3072', RS3_PERF: '1' };
  for (const key of ['RS3_DATA_DIR', 'RS3_PUBLIC_ORIGIN', 'RS3_LOOPBACK_PORT', 'RS3_PRIVATE_ADDON', 'RS3_PRIVATE_ADDON_SHA256', 'RS3_GAME_DATA_DIR', 'RS3_MAP_ASSETS_DIR', 'RS3_TERRAIN_ASSETS_DIR', 'RS3_ICON_ASSETS_DIR']) delete environment[key];
  const before = path.resolve(opt('before', '.')), after = path.resolve(opt('after', '.'));
  const pairs = Number(opt('pairs', '1')), dwellMs = Number(opt('dwell-ms', '12000')), interruptMs = Number(opt('interrupt-ms', '0')), out = path.resolve(opt('out'));
  assert(Number.isFinite(interruptMs) && interruptMs >= 0 && interruptMs <= 60000);
  assert(Number.isFinite(dwellMs) && dwellMs >= 0 && dwellMs <= 60000);
  assert(Number.isInteger(pairs) && pairs >= 1 && pairs <= 100);
  const scenario = opt('scenario', interruptMs > 0 ? 'unlock-running' : 'switch');
  assert(['switch', 'unlock-running', 'unlock-idle'].includes(scenario));
  const requirePreparation = opt('require-preparation', 'on') !== 'off';
  const report = { scenario, requirePreparation, complete: false, format: 'synthetic-member-switch-v1', node: process.version, before, after, pairs, dwellMs, interruptMs, fixture: receipt.profile.sha256, observations: [] };
  async function observation(root, variant, pair) {
    const scratch = await mkdtemp(path.join(tmpdir(), 'member-switch-'));
    let child, browser, timer, sampling = false, peakServer = 0, peakTotal = 0, peakBrowser = 0, peakAll = 0, samples = 0, lastDiscovery = -Infinity, processRows = [];
    const rss = async () => {
      if (sampling || !child?.pid) return; sampling = true;
      try {
        // Discover children once per second, sample only owned RSS at 50 ms.
        // /proc/<pid>/task/<tid>/children is unavailable on some runner kernels.
        if (performance.now() - lastDiscovery >= 1000) {
          lastDiscovery = performance.now();
          processRows = (await Promise.all((await readdir('/proc')).filter(name => /^\d+$/.test(name)).map(async pid => {
            try {
              const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
              return { pid: Number(pid), ppid: Number(/^\d+ \(.+\) \S+ (\d+) /.exec(stat)?.[1]) };
            } catch { return null; }
          }))).filter(Boolean);
        }
        const descendants = root => {
          const owned = new Set(root ? [root] : []); let previous;
          do { previous = owned.size; for (const row of processRows) if (owned.has(row.ppid)) owned.add(row.pid); } while (owned.size !== previous);
          return owned;
        };
        const serverOwned = descendants(child.pid), browserOwned = descendants(browser?.child?.pid);
        const rows = await Promise.all([...new Set([...serverOwned, ...browserOwned])].map(async pid => {
          try { const status = await readFile(`/proc/${pid}/status`, 'utf8'); return { pid, rss: Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0) * 1024 }; }
          catch { return { pid, rss: 0 }; }
        }));
        peakServer = Math.max(peakServer, rows.find(row => row.pid === child.pid)?.rss ?? 0);
        peakTotal = Math.max(peakTotal, rows.reduce((sum, row) => sum + (serverOwned.has(row.pid) ? row.rss : 0), 0));
        peakBrowser = Math.max(peakBrowser, rows.reduce((sum, row) => sum + (browserOwned.has(row.pid) ? row.rss : 0), 0));
        peakAll = Math.max(peakAll, rows.reduce((sum, row) => sum + row.rss, 0)); samples++;
      } finally { sampling = false; }
    };
    try {
      let stderr = '';
      child = fork(here, ['--child', '--root', root, '--scratch', path.join(scratch, 'save')], { env: environment, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
      child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-6000); });
      timer = setInterval(() => void rss(), 50);
      const ready = await new Promise((resolve, reject) => {
        const deadline = setTimeout(() => reject(new Error('Server startup timeout')), 240000);
        child.once('message', message => { clearTimeout(deadline); resolve(message); });
        child.once('exit', code => { clearTimeout(deadline); reject(new Error(`Server exited ${code}: ${stderr}`)); });
      });
      browser = await openChrome(opt('chrome', '/usr/bin/chromium'), path.join(scratch, 'chrome'), { extraArgs: ['--no-sandbox', '--disable-dev-shm-usage'] });
      await browser.send('Network.enable', { maxTotalBufferSize: 256 * 1024 ** 2, maxResourceBufferSize: 128 * 1024 ** 2 });
      await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__rs3Perf={enabled:true,events:[]};window.__prepare=[];const originalFetch=window.fetch;window.fetch=async function(url,options){const p=options?.method==='HEAD'?{start:performance.now()}:undefined;if(p)window.__prepare.push(p);try{const r=await originalFetch.call(this,url,options);if(p){p.status=r.status;p.end=performance.now();}return r;}catch(e){if(p){p.error=e.name;p.end=performance.now();}throw e;}};window.__switchJSON=[];const json=Response.prototype.json;Response.prototype.json=async function(...args){const start=performance.now(),v=await json.apply(this,args);if(new URL(this.url,location.href).pathname==='/api/tasks')window.__switchJSON.push({start,end:performance.now(),member:v.memberId});return v;};localStorage.setItem('rs3:task-view',JSON.stringify({groupView:false}));` });
      // Authenticate before the app opens; response bodies are never written to the report.
      await browser.send('Page.navigate', { url: ready.inviteUrl });
      await until(() => browser.evaluate(`window.__rs3Perf?.events.some(e=>e.name==='tasks-shown')`), 240000);
      await browser.evaluate(`(()=>{let e=document.getElementById('group-view');if(e.checked){e.checked=false;e.dispatchEvent(new Event('change',{bubbles:true}));}})()`);
      await until(() => browser.evaluate(`/[0-9,]+ possible tasks/.test(document.getElementById('task-engine-status')?.textContent??'')`), 240000);
      const firstOpen = await browser.evaluate('window.__rs3Perf.events.find(e=>e.name===\"tasks-shown\")');
      console.log(JSON.stringify({variant,pair,stage:'first-open',ms:firstOpen.time}));
      if (scenario !== 'switch') {
        await new Promise(resolve => setTimeout(resolve, scenario === 'unlock-idle' ? dwellMs : interruptMs));
        const preparationAtAction = await browser.evaluate(`fetch('/api/diagnostics').then(r=>r.json()).then(d=>d.memberPreparation??{active:0,pending:0,ready:0})`);
        if (variant === 'after' && requirePreparation) {
          if (scenario === 'unlock-running') assert.equal(preparationAtAction.active, 1, 'Interruption requires active preparation');
          else { assert.equal(preparationAtAction.active, 0); assert.equal(preparationAtAction.pending, 0); assert.equal(preparationAtAction.ready, 1, 'Idle unlock requires completed preparation'); }
        }
        const started = await browser.evaluate(`(async () => {
          const {createLiveSwapCommandClient}=await import('/live-swap-client.mjs');
          const world=await(await fetch('/api/display-world')).json(), saved=await(await fetch('/api/state?view=play-v1')).json();
          const unlockChunk=world.surface.find(id=>!saved.state.members[0].unlocked.includes(id));
          if(!unlockChunk)throw Error('No locked surface chunk');
          const storage=new Map();
          window.__interruptClient=createLiveSwapCommandClient({storage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}});
          window.__rs3Perf.events=[];
          const start=performance.now();
          void window.__interruptClient.send({expectedRevision:${firstOpen.revision},command:{type:'set-chunk',memberId:${JSON.stringify(ready.members[0])},chunkId:unlockChunk,status:'unlocked'}})
            .then(r=>{window.__interruptStatus=r.response.status;}).catch(e=>{window.__interruptStatus=e.status??500;});
          return start;
        })()`);
        const event = await until(async () => { const status = await browser.evaluate('window.__interruptStatus'); if (status >= 400) throw new Error(`Diagnostic unlock failed: ${status}`); return browser.evaluate(`window.__rs3Perf.events.find(e=>e.name==='tasks-shown'&&e.revision>${firstOpen.revision})`); }, 240000);
        const interruption = { ms: event.time - started, event, status: await browser.evaluate('window.__interruptStatus') };
        await rss(); assert(peakServer > 0 && peakTotal > 0, 'RSS sampling failed');
        // Freeze primary-action memory before response-equivalence work. These
        // reads deliberately calculate the other member after the timed unlock.
        clearInterval(timer);
        const primaryMemory = { peakServer, peakTotal, peakBrowser, peakAll, samples };
        const preparationAfterAction = await browser.evaluate(`fetch('/api/diagnostics').then(r=>r.json()).then(d=>d.memberPreparation??{active:0,pending:0,ready:0})`);
        const invite = new URL(ready.inviteUrl), headers = { Authorization: `Bearer ${invite.pathname.slice('/join/'.length)}` };
        const validation = [];
        for (const member of ready.members) for (const lane of ['personal', 'sidebar', 'peer']) {
          const peer = ready.members.find(id => id !== member), revision = event.revision;
          const extra = lane === 'personal' ? '' : lane === 'sidebar' ? `&projection=duo-sidebar-v1&revision=${revision}` : `&lane=duo-v1&peerFor=${encodeURIComponent(peer)}&revision=${revision}`;
          const response = await fetch(`${invite.origin}/api/tasks?memberId=${encodeURIComponent(member)}&view=play-v1${extra}`, { headers });
          assert.equal(response.status, 200); const value = await response.json();
          assert.equal(value.stateRevision, revision); assert.equal(value.memberId, member);
          delete value.cache; if (value.metrics) delete value.metrics.elapsedMs;
          validation.push({ member, lane, revision, rows: value.tasks.length, hash: sha(value) });
        }
        return { variant, pair, startupMs: ready.startupMs, firstOpen, preparationAtAction, preparationAfterAction, validation,
          preparation: await browser.evaluate('window.__prepare'), interruption, switches: [], ...primaryMemory };
      }
      await new Promise(resolve => setTimeout(resolve, dwellMs));
      const preparation = await browser.evaluate('window.__prepare');
      const preparationAtAction = await browser.evaluate(`fetch('/api/diagnostics').then(r=>r.json()).then(d=>d.memberPreparation??{active:0,pending:0,ready:0})`);
      if (variant === 'after' && requirePreparation && before !== after) assert.equal(preparationAtAction.ready, 1, 'Switch requires completed preparation');
      const network = new Map();
      browser.listeners.add(message => {
        const p = message.params;
        if (message.method === 'Network.requestWillBeSent' && p.request.method === 'GET' && new URL(p.request.url).pathname === '/api/tasks') network.set(p.requestId, { start: p.timestamp, memberId: new URL(p.request.url).searchParams.get('memberId') });
        if (message.method === 'Network.responseReceived' && network.has(p.requestId)) Object.assign(network.get(p.requestId), { headers: p.timestamp, status: p.response.status, timing: p.response.timing });
        if (message.method === 'Network.loadingFinished' && network.has(p.requestId)) Object.assign(network.get(p.requestId), { end: p.timestamp, encoded: p.encodedDataLength });
      });
      const switches = [];
      for (const group of [false, true]) {
        if (group) {
          await browser.evaluate(`(()=>{let e=document.getElementById('group-view');e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
          await until(() => browser.evaluate(`window.__rs3Perf.events.some(e=>e.name==='duo-tasks-shown')`), 240000);
        }
        for (const member of [ready.members[1], ready.members[0]]) {
          network.clear();
          const started = await browser.evaluate(`(()=>{window.__rs3Perf.events=[];window.__switchJSON=[];performance.clearResourceTimings();const start=performance.now();const e=document.getElementById('member');e.value=${JSON.stringify(member)};e.dispatchEvent(new Event('change',{bubbles:true}));return start;})()`);
          const event = await until(() => browser.evaluate(`window.__rs3Perf.events.find(e=>e.name==='${group ? 'duo-tasks-shown' : 'tasks-shown'}'&&e.memberId===${JSON.stringify(member)})`), 240000);
          // Group can paint from its existing cache before its background HTTP read ends.
          await until(() => browser.evaluate(`/[0-9,]+ possible tasks/.test(document.getElementById('task-engine-status')?.textContent??'')`), 240000);
          await until(() => [...network.values()].some(r => r.memberId === member && r.end !== undefined), 240000);
          const jsonTimings = await browser.evaluate('window.__switchJSON');
          const resources = await browser.evaluate(`performance.getEntriesByType('resource').filter(e=>new URL(e.name).pathname==='/api/tasks').map(e=>({start:e.startTime,headers:e.responseStart,end:e.responseEnd,decoded:e.decodedBodySize,encoded:e.encodedBodySize}))`);
          const responses = [];
          for (const [requestId, timings] of network) {
            if (!timings.end) continue;
            const body = await browser.send('Network.getResponseBody', { requestId });
            assert.equal(timings.status, 200);
            const parsed = JSON.parse(body.base64Encoded ? Buffer.from(body.body, 'base64').toString() : body.body);
            const cache = parsed.cache; delete parsed.cache; if (parsed.metrics) delete parsed.metrics.elapsedMs;
            responses.push({ ...timings, cache, hash: sha(parsed), rows: parsed.tasks?.length, blocked: parsed.tasks?.filter(row=>row.status==='blocked').length, available: parsed.tasks?.filter(row=>row.status==='available').length });
          }
          console.log(JSON.stringify({variant,pair,stage:'switch',group,member,ms:event.time-started}));
          switches.push({ group, member, totalMs: event.time - started, started, event, jsonTimings, resources, responses });
        }
      }
      await rss(); assert(peakServer > 0 && peakTotal > 0, 'RSS sampling failed');
      return { variant, pair, startupMs: ready.startupMs, firstOpen, preparationAtAction, preparation, switches, peakServer, peakTotal, peakBrowser, peakAll, samples };
    } finally {
      clearInterval(timer); await browser?.close();
      if (child?.connected) { child.send('stop'); await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5000))]); }
      await stopChild(child); await rm(scratch, { recursive: true, force: true });
    }
  }
  for (let pair = 0; pair < pairs; pair++) {
    for (const variant of pair % 2 ? ['after', 'before'] : ['before', 'after']) {
      const row = await observation(variant === 'before' ? before : after, variant, pair); report.observations.push(row);
      if (report.observations.length % 2 === 0) {
        const a = report.observations.at(-2);
        assert.deepEqual(a.switches.map(s => s.responses.map(r => r.hash)), row.switches.map(s => s.responses.map(r => r.hash)), 'Full task response parity');
        assert.deepEqual(a.validation, row.validation, 'Both members and all group lanes must match after unlock');
      }
      await writeFile(out, JSON.stringify(report, null, 2) + '\n');
      console.log(JSON.stringify({ variant, pair, peakServerMiB: row.peakServer / 1048576, peakTotalMiB: row.peakTotal / 1048576, interruption: row.interruption, switches: row.switches.map(s=>({group:s.group,member:s.member,totalMs:s.totalMs,cache:s.responses.map(r=>r.cache),resources:s.resources})) }));
    }
  }
  report.complete = true;
  await writeFile(out, JSON.stringify(report, null, 2) + '\n');
}
