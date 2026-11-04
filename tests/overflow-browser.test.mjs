import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { findChrome } from '../scripts/ci/gallery-support.mjs';
import { openChrome, until } from '../scripts/perf/cdp.mjs';
import { detectOverflow } from '../scripts/screens/overflow-detector.mjs';
import { prepareOverflowFixture } from '../scripts/screens/overflow-fixture.mjs';

// Static host, using the real gallery renderer and shipped shell at native widths.
// The independent public catalogues bootstrap browser modules; gallery fixture
// data supplies the synthetic gameplay and all feature controls remain enabled.
process.env.RS3_DATASET = 'open-f2p';
const { materializeDatasetValues } = await import('../app/dataset-runtime.mjs');
const values = await materializeDatasetValues();
const app = new URL('../app/', import.meta.url), web = new URL('web/', app);
const reference = process.env.RS3_OVERFLOW_REF;
if (reference && !/^[a-f0-9]{40}$/.test(reference)) throw new Error('Expected a full START SHA');
const sourceCache = new Map();
async function source(url) {
  if (!reference) return readFile(url);
  const filename = path.relative(fileURLToPath(new URL('../', import.meta.url)), fileURLToPath(url)).split(path.sep).join('/');
  if (!sourceCache.has(filename)) sourceCache.set(filename, promisify(execFile)('git', ['show', `${reference}:${filename}`],
    { cwd:new URL('../',import.meta.url), encoding:'buffer', maxBuffer:16*1024*1024 }).then(result=>result.stdout));
  return sourceCache.get(filename);
}
const phase = process.env.RS3_OVERFLOW_PHASE ?? 'after';
const artifacts = path.resolve(process.env.RS3_OVERFLOW_OUTPUT ?? 'var/overflow-gate');
const expectedTabs = ['contents', 'tasks', 'clues', 'unlock', 'note', 'interior', 'access'];
const controlKinds = new Set(['hidden-group-overflow', 'clipped-control', 'occluded-control', 'small-touch-target']);
// Intentional exceptions must describe one selector/state/input/bounded geometry.
// Do not exempt a whole surface or text-range whitespace/ellipsis observations.
const intentional = [];
for (const rule of intentional) {
  assert.ok(typeof rule.state==='string' && rule.state && typeof rule.coarse==='boolean');
  assert.ok(typeof rule.selector==='string' && rule.selector && !/[*,]/.test(rule.selector),'one exact detector selector');
  assert.ok(controlKinds.has(rule.kind) && typeof rule.reason==='string' && rule.reason.length>=10);
  assert.ok(['width','height'].every(key=>Array.isArray(rule.bounds?.[key]) && rule.bounds[key].length===2 && rule.bounds[key].every(Number.isFinite) && rule.bounds[key][0]<=rule.bounds[key][1]),'explicit numeric bounds');
}

test('permanent native overflow gate', { timeout: 120000 }, async t => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'rs3-overflow-'));
  const shell = String(await source(new URL('index.html', web))).replace('<script type="module" src="/main.mjs"></script>', '<link rel="stylesheet" href="/gallery.css"><link rel="stylesheet" href="/duo-tasks.css"><script type="module" src="/gallery-preview.mjs"></script>');
  const preview = String(await source(new URL('gallery-preview.mjs', web))).replace('await build(); await render(entry);', `await build(); ${prepareOverflowFixture}\nawait render(entry);`);
  const server = createServer(async (request, response) => {
    try {
      const route = new URL(request.url, 'http://fixture').pathname;
      const file = new URL('.' + route, web);
      if (!file.href.startsWith(web.href)) throw new Error('Outside fixture');
      const bytes = route === '/' ? shell : route === '/gallery-preview.mjs' ? preview
        : route === '/data/dataset-runtime.json' ? JSON.stringify({ dataset:{ id:'synthetic', digest:'overflow-fixture' }, capabilities:{}, values })
          : await source(file).catch(() => source(new URL('.' + route, app)));
      response.setHeader('Content-Type', route === '/' ? 'text/html' : route.endsWith('.json') ? 'application/json' : route.endsWith('.css') ? 'text/css' : route.endsWith('.svg') ? 'image/svg+xml' : 'text/javascript');
      response.end(bytes);
    } catch { response.writeHead(404); response.end(); }
  });
  let browser;
  const measurements = [];
  try {
    await mkdir(artifacts, { recursive:true });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    browser = await openChrome(await findChrome(), path.join(scratch, 'chrome'), { extraArgs:[
      '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4',
      ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
    ] });
    const settle = () => browser.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    const load = async (entry = 'main', width = 1440, height = 900, coarse = false, members = 2) => {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor:1, mobile:coarse });
      await browser.send('Emulation.setTouchEmulationEnabled', { enabled:coarse, maxTouchPoints:1 });
      await browser.send('Page.navigate', { url:`http://127.0.0.1:${server.address().port}/?entry=${entry}&theme=dark&capture=1&members=${members}` });
      await until(async () => {
        const error = await browser.evaluate('document.documentElement?.dataset.galleryError');
        if (error) throw new Error(error + '\n' + await browser.evaluate('document.documentElement.dataset.galleryErrorStack'));
        return browser.evaluate('document.documentElement?.dataset.galleryReady === "true"');
      });
      assert.equal(await browser.evaluate('innerWidth'), width);
      assert.equal(await browser.evaluate("matchMedia('(pointer:coarse)').matches"), coarse);
      await settle();
    };
    const shot = async name => {
      const png = await browser.send('Page.captureScreenshot', { format:'png', captureBeyondViewport:false });
      await writeFile(path.join(artifacts, `${name}__${phase}.png`), Buffer.from(png.data, 'base64'));
    };
    const scan = async (state, root, extra = {}) => {
      await settle();
      const result = await browser.evaluate(`(${detectOverflow})(${JSON.stringify({ root })})`);
      assert.equal(result.error, undefined, 'scan root exists');
      const paging = await browser.evaluate(`(() => {
        const hits=${JSON.stringify(result.hits)};
        return hits.map(hit => {
          const n=document.querySelector(hit.selector); if(!n)return null;
          // Only the native map select may sit in its 1 px proxy, and only while every member has a visible, hit-testable switch button.
          const proxy=n.closest('.member-switch:not(:empty)+.member-picker');
          if(proxy&&n.matches('#member')){const s=getComputedStyle(proxy),r=proxy.getBoundingClientRect();
            const buttons=[...document.querySelectorAll('#member-switch button')];
            const reachable=buttons.length===n.options.length&&buttons.every(b=>{const q=b.getBoundingClientRect();if(!b.checkVisibility()||q.width<1||q.height<1)return false;const h=document.elementFromPoint(q.x+q.width/2,q.y+q.height/2);return h===b||b.contains(h);});
            if(s.clip!=='auto'&&s.position==='absolute'&&r.width<=1&&r.height<=1&&reachable)return 'accessible-proxy';}
          const style=getComputedStyle(n);
          if(hit.kind==='hidden-group-overflow'&&n.matches('button,[role=button]')&&style.textOverflow==='ellipsis'&&style.whiteSpace==='nowrap'&&/hidden|clip/.test(style.overflowX))return 'visible-ellipsis';
          if(!['clipped-control','occluded-control'].includes(hit.kind))return null;
          const r=n.getBoundingClientRect();
          if(r.left<0||r.right>innerWidth||hit.measurements.visibleWidth<r.width-1)return null;
          let bottom=innerHeight,top=0,scroll=false;
          const tabs=document.querySelector('#phone-tabs');
          if(tabs?.checkVisibility()&&!n.closest('dialog[open]')&&!tabs.contains(n))bottom=Math.min(bottom,tabs.getBoundingClientRect().top);
          for(let p=n.parentElement;p;p=p.parentElement){const s=getComputedStyle(p),b=p.getBoundingClientRect();
            if(!scroll&&/hidden|clip/.test(s.overflowY)&&(r.top<b.top-1||r.bottom>b.top+p.clientHeight+1))return null;
            if(/auto|scroll/.test(s.overflowY)&&p.scrollHeight>p.clientHeight+1){scroll=true;top=Math.max(top,b.top);bottom=Math.min(bottom,b.top+p.clientHeight);}
          }
          return scroll&&(r.top<top||r.bottom>bottom)?'vertical-page':null;
        });
      })()`);
      result.hits.forEach((hit,index)=>{if(paging[index])result.exclusions[paging[index]]=(result.exclusions[paging[index]]??0)+1;});
      const failures = result.hits.filter((hit,index)=>!paging[index]).filter(hit => controlKinds.has(hit.kind) && !intentional.some(rule =>
        rule.state === state && rule.coarse === result.coarse && rule.selector === hit.selector && rule.kind === hit.kind && rule.reason && Object.entries(rule.bounds).every(([key,[min,max]])=>hit.measurements.box[key]>=min && hit.measurements.box[key]<=max)));
      const controls = await browser.evaluate(`(() => {
        const root=document.querySelector(${JSON.stringify(root)}),selector='button,a[href],input,select,textarea,summary,[role=tab]';
        return [root,...root.querySelectorAll(selector)].filter(n=>n.matches(selector)&&n.checkVisibility()).map(n=>{
          const r=n.getBoundingClientRect();return {id:n.id||n.tagName.toLowerCase(),width:r.width,height:r.height,left:r.left,right:r.right,top:r.top,bottom:r.bottom,scroll:n.scrollWidth,client:n.clientWidth};
        });
      })()`);
      const sample = { state, ...extra, ...result, controls, failures };
      measurements.push(sample);
      await writeFile(path.join(artifacts, `measurements__${phase}.json`), JSON.stringify(measurements, null, 2));
      // Retain viewport screenshots and the detector's full measurements before failing.
      if (failures.length) await shot('failure-' + state);
      assert.deepEqual(failures, [], `${state}: hidden/unreachable controls: ${JSON.stringify(failures)}`);
    };
    const pointer = async selector => {
      const point = await browser.evaluate(`(() => { const n = document.querySelector(${JSON.stringify(selector)}); if (!n) throw new Error('Missing pointer target'); const r = n.getBoundingClientRect(); const hit = document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); return {x:r.x+r.width/2,y:r.y+r.height/2,owns:hit===n||n.contains(hit)}; })()`);
      assert.equal(point.owns, true, selector + ' owns pointer centre');
      for (const type of ['mousePressed', 'mouseReleased']) await browser.send('Input.dispatchMouseEvent', { type, x:point.x, y:point.y, button:'left', clickCount:1 });
      await settle();
    };
    const steps = [];
    const check = (name, run) => t.test(name, async () => {
      steps.push(name);
      try { await run(); }
      catch (error) {
        await shot('failure-' + name.replaceAll(/[^a-z0-9-]/gi,'-'));
        await writeFile(path.join(artifacts, 'failure-steps__' + phase + '.json'), JSON.stringify({ steps, error:error.message }, null, 2));
        throw error;
      }
    });
    for (const [width,height,coarse] of [[1440,900,false],[844,390,true]]) for (const route of ['map', 'task-location']) await check('seven-tab native dock via ' + route + '/' + width, async () => {
      await load('main',width,height,coarse);
      if (route === 'map') {
        await browser.evaluate("overflowFixture.c.map.centerOnChunk('12342'); if(overflowFixture.c.phoneLayout.isPhone)document.querySelector('#map-hover').scrollIntoView({block:'center'})"); await settle();
        await pointer('#map-hover');
      } else {
        // Use the real task guidance location renderer and its shipped callback.
        await browser.evaluate(`(() => { const c=overflowFixture.c; c.showTask({...c.result.tasks[2], locations:['12342'], sources:[{kind:'chunks',name:'Synthetic location',locations:['12342']}]},true); })()`);
        await settle();
        const location = await browser.evaluate(`(() => { const n=[...document.querySelectorAll('#dialog-content button')].find(n=>n.textContent.includes('View location')); if(n){n.id='overflow-task-location';for(let p=n.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;n.scrollIntoView({block:'center'});} return n?.textContent; })()`);
        assert.ok(location, 'task-location entry is present');
        await pointer('#overflow-task-location');
      }
      const tabs = await browser.evaluate("[...document.querySelectorAll('#chunk-info [role=tab]')].map(n=>n.dataset.tab)");
      assert.deepEqual(tabs, expectedTabs, 'all seven tabs, including Preview and saved Note, must exist');
      const row = await browser.evaluate("(() => { const n=document.querySelector('#chunk-info [role=tablist]'); return {scroll:n.scrollWidth,client:n.clientWidth}; })()");
      await browser.evaluate("document.querySelector('#chunk-info [role=tablist]').scrollIntoView({block:'center'})");
      await shot(`DA2-01-${route}__${width}x${height}`);
      if(route==='map')await shot(`DA2-01__${width}x${height}`);
      await scan('seven-tabs-' + route + '-' + width, '#chunk-info [role=tablist]', { row });
      assert.ok(row.scroll <= row.client + 1, 'seven tabs fit the real dock');
      for (const tab of expectedTabs) {
        await browser.evaluate(`document.querySelector('#chunk-info [data-tab=${tab}]').scrollIntoView({block:'nearest'})`);
        await pointer(`#chunk-info [data-tab=${tab}]`);
        assert.equal(await browser.evaluate(`document.querySelector('#chunk-info [data-tab=${tab}]').getAttribute('aria-selected')`), 'true');
      }
      for (const [key, wanted] of [['Home','contents'], ['End','access'], ['ArrowRight','contents'], ['ArrowLeft','access']]) {
        await browser.send('Input.dispatchKeyEvent', { type:'keyDown', key });
        assert.equal(await browser.evaluate('document.activeElement.dataset.tab'), wanted);
      }
    });
    for (const [width,height,coarse] of [[1440,900,false],[844,390,true]]) for (const members of [2,3]) await check('long-name header ' + members + '/' + width, async () => {
      await load('main',width,height,coarse,members);
      assert.equal(await browser.evaluate("document.querySelectorAll('#member-switch button').length"), members);
      assert.deepEqual(await browser.evaluate("[...document.querySelector('.topbar nav, #phone-tools nav').children].map(n=>n.id)"), coarse ? ['account-tools','helper-open','search-open','info-tools','runemetrics-open','admin-tools','more-tools'] : ['helper-open','search-open','info-tools','runemetrics-open','admin-tools','more-tools','account-tools']);
      await shot(`DA2-04-${members}__${width}x${height}`);
      if(members===2)await shot(`DA2-04__${width}x${height}`);
      await scan('header-' + members + '-' + width, '.topbar');
      const names = await browser.evaluate(`overflowFixture.c.state.members.map(n=>n.name)`);
      for(const [index,name] of names.entries()) {
        const displayed=await browser.evaluate(`(()=>{const n=document.querySelectorAll('#member-switch button')[${index}];return {text:n.textContent,title:n.title,label:n.getAttribute('aria-label')};})()`);
        assert.equal(displayed.text,Array.from(name).slice(0,20).join('')+'…');
        assert.equal(displayed.title,name);assert.equal(displayed.label,name);
      }
    });
    for (const [width,height,coarse] of [[1440,900,false],[844,390,true]]) await check('maximal context menu ' + width, async () => {
      await load('main',width,height,coarse);
      await browser.evaluate(`(() => { const c=overflowFixture.c; const r=c.$('map-hover').getBoundingClientRect(); c.chunkMenu('12342',r.left+100,r.top+100,${JSON.stringify(coarse ? 'touch':'mouse')}); })()`);
      assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('#map-menu button,#map-menu a')].map(n=>n.textContent.trim())"), coarse
        ? ['Chunk details','Unlock','Never roll','Remove from roll pool','Preview unlock','Sticker ▸','Colour','Search the Wiki']
        : ['Chunk details','Unlock','Never roll','Remove from roll poolCtrl/Cmd-click','Preview unlock','Sticker ▸','Colour','Search the Wiki']);
      const menu = await browser.evaluate("(() => {const n=document.querySelector('#map-menu'),r=n.getBoundingClientRect(),tabs=document.querySelector('#phone-tabs');return {top:r.top,bottom:r.bottom,height:r.height,scroll:n.scrollHeight,client:n.clientHeight,usable:tabs.checkVisibility()?tabs.getBoundingClientRect().top:innerHeight};})()");
      await shot(`DA2-02__${width}x${height}`);
      await scan('context-' + width, '#map-menu', { menu });
      assert.ok(menu.top >= 0 && menu.bottom <= menu.usable, 'context menu stays above fixed tabs');
      // A height-capped flex menu must not crush its title to make room for actions.
      const title = await browser.evaluate("(() => {const n=document.querySelector('#map-menu .map-menu-title');return n?{height:n.getBoundingClientRect().height,scroll:n.scrollHeight}:null;})()");
      assert.ok(title && title.height >= title.scroll - 1 && title.height >= 16, `context menu title keeps its height: ${JSON.stringify(title)}`);
      const pagePosition = await browser.evaluate('[scrollX,scrollY]');
      for (const selector of ['button:first-of-type','a:last-child']) {
        await browser.evaluate(`document.querySelector('#map-menu ${selector}').scrollIntoView({block:'nearest'})`);
        await scan('context-' + width + '-' + selector, '#map-menu');
      }
      assert.deepEqual(await browser.evaluate('[scrollX,scrollY]'),pagePosition,'menu actions scroll inside the menu');
      if(coarse)assert.ok(await browser.evaluate("document.querySelector('#map-menu').scrollTop>0"),'last action needs internal menu scrolling');
    });
    for (const [width,height,coarse,listWidth] of [[1440,900,false,249],[1440,900,false,339],[390,844,true,342],[844,390,true,796]]) await check('narrow owner chooser ' + listWidth, async () => {
      await load('main',width,height,coarse);
      await browser.evaluate(`(async () => {
        const c=overflowFixture.c;
        const {createDuoTaskView}=await import('/duo-task-view.mjs');
        const view=createDuoTaskView({document,getState:()=>c.state,getSelectedMember:()=>c.memberId,getStorage:()=>null,command:async()=>{},backlog:()=>{},showTask:()=>{},showError:e=>{throw e}});
        const row=view.row({task:c.result.tasks[2],memberIds:['player1','player2'],label:'Both',facts:{group:false,personal:false,completedBy:[]}});
        c.$('active-tasks').replaceChildren(row);
        const style=getComputedStyle(document.querySelector('.task-sidebar')); const extra=['paddingLeft','paddingRight','borderLeftWidth','borderRightWidth'].reduce((sum,key)=>sum+parseFloat(style[key]),0);
        document.querySelector('.workspace').style.gridTemplateColumns='minmax(0,1fr) '+(${listWidth}+extra)+'px';
        if(c.phoneLayout)c.$('phone-tab-tasks').click();
        row.querySelector('.duo-task-backlog').click();

      })()`);
      await settle();
      await browser.evaluate("document.querySelector('.duo-task-chooser').scrollIntoView({block:'center'})");
      assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('.duo-task-chooser option')].map(n=>n.value)"), ['player1','player2']);
      const chooser = await browser.evaluate("(() => {const n=document.querySelector('.duo-task-chooser'),s=n.querySelector('select'),r=s.getBoundingClientRect();return {scroll:n.scrollWidth,client:n.clientWidth,selectWidth:r.width,list:document.querySelector('#active-tasks').clientWidth};})()");
      await shot(`DA2-03-chooser-${listWidth}__${width}x${height}`);
      if(listWidth===249||coarse)await shot(`DA2-03__${width}x${height}`);
      await scan('chooser-' + listWidth, '.duo-task-chooser', { chooser });
      assert.ok(chooser.scroll <= chooser.client + 1);
      if(!coarse) assert.equal(chooser.list,listWidth,'native compact/expanded list width');
      const options = await browser.evaluate("[...document.querySelectorAll('.duo-task-chooser option')].map(n=>({text:n.textContent,title:n.title,label:n.getAttribute('aria-label')}))");
      for(const option of options){assert.ok(Array.from(option.text).length<=21);assert.equal(option.label,option.title);assert.ok(option.title.length>20);}
    });
    await check('profile member toolbar on coarse phone', async () => {
      await load('profile',390,844,true);
      assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('.profile-toolbar option')].map(n=>n.value)"), ['player1','player2']);
      await shot('DA2-03-profile__390x844');
      await scan('profile', '.profile-toolbar');
    });
    for (const [width,height,coarse] of [[1440,900,false],[844,390,true]]) await check('merged More menu ' + width, async () => {
      await load('main',width,height,coarse);
      await browser.evaluate("overflowFixture.topBar.apply(['helper','search','info','sync']); if(overflowFixture.c.phoneLayout)document.querySelector('#phone-tab-more').click(); document.querySelector('#more-tools').open=true");
      const items = await browser.evaluate("[...document.querySelectorAll('#more-tools .more-tools-menu button')].filter(n=>!n.hidden).map(n=>n.id)");
      assert.deepEqual(items, ['helper-open','search-open','runemetrics-open','bis-open','profile-open','finish-line-open','activity-open','teleports-open','partner-supply-open','boss-gates-open','rules-open','completed-open','journal-open','history-open','help-open','settings-open','game-plugin-open','map-display-open','screenshot-open','map-image-open','stream-safe-toggle','backup-open','original-sync-open','whats-new-open','roadmap-open','map-sources-open','theme-dark','theme-gray','theme-light']);
      await scan('more-' + width, '#more-tools .more-tools-menu');
      for (const id of items) {
        await browser.evaluate(`document.getElementById(${JSON.stringify(id)}).scrollIntoView({block:'nearest'})`);
        const n = await browser.evaluate(`(() => {const n=document.getElementById(${JSON.stringify(id)}),r=n.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===n||n.contains(hit);})()`);
        assert.equal(n,true,id+' can be reached in merged More');
      }
    });
    for (const entry of ['coordination','about','task-detail']) for (const [width,height] of [[390,844],[844,390],[820,1180]]) await check('standalone touch links ' + entry + '/' + width, async () => {
      await load(entry,width,height,true);
      const selector = entry === 'coordination' ? '.duo-catchup a,.duo-live a' : '#dialog-content a[target=_blank]';
      const links = await browser.evaluate(`(()=>{const nodes=[...document.querySelectorAll(${JSON.stringify(selector)})];nodes.forEach((n,i)=>n.id='overflow-link-'+i);return nodes.map(n=>({id:n.id,text:n.textContent}));})()`);
      assert.deepEqual(links.map(link=>link.text), entry==='coordination'?['Open History','Open History']:entry==='task-detail'?['Open RuneScape Wiki']:
        ['Jagex Fan Content Policy','Mejrs mapping project','RuneScape Wiki mapping project','Weird Gloop','Terrain repository','Pin snapshot and labels','Wiki icon legend and file credits','Wiki licensing policy'], 'complete standalone action set');
      for (const [index,{id}] of links.entries()) {
        await browser.evaluate(`document.getElementById(${JSON.stringify(id)}).scrollIntoView({block:'center'})`);
        if(index===0){await shot(`DA2-05-${entry}__${width}x${height}`);if(entry==='coordination')await shot(`DA2-05__${width}x${height}`);}
        await scan('link-' + entry + '-' + width + '-' + id, '#' + id);
      }
    });
    assert.deepEqual(steps.sort(), [
      'seven-tab native dock via map/1440','seven-tab native dock via task-location/1440','seven-tab native dock via map/844','seven-tab native dock via task-location/844',
      'long-name header 2/1440','long-name header 3/1440','long-name header 2/844','long-name header 3/844',
      'maximal context menu 1440','maximal context menu 844','narrow owner chooser 249','narrow owner chooser 339','narrow owner chooser 342','narrow owner chooser 796',
      'profile member toolbar on coarse phone','merged More menu 1440','merged More menu 844',
      'standalone touch links coordination/390','standalone touch links coordination/844','standalone touch links coordination/820',
      'standalone touch links about/390','standalone touch links about/844','standalone touch links about/820',
      'standalone touch links task-detail/390','standalone touch links task-detail/844','standalone touch links task-detail/820',
    ].sort(),'all expected overflow steps ran');
  } finally {
    await browser?.close(); await new Promise(resolve => server.close(resolve));
    await rm(scratch, { recursive:true, force:true });
  }
});
