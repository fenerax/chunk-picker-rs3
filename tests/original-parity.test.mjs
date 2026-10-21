import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertPinnedSourceHash, assertRetainedSourceHash, captureOriginal, RETAINED_SOURCE_SHA256, computedHTMLExpression, guardSource, isFirebaseURL, readOnlySocketAction, recomputeActiveExpression,
  runOriginalParityCli, shouldBlockRequest, snapshotExpression, readOriginalWorker,
} from '../scripts/research/original-parity.mjs';

test('both source pins accept line-ending normalization and reject changed executable code', () => {
  const hash=createHash('sha256').update('const safe = true;\n').digest('hex');
  for(const name of ['index.js','worker.js']) {
    assert.doesNotThrow(()=>assertRetainedSourceHash(name,hash,'const safe = true;\r\n'));
    assert.throws(()=>assertRetainedSourceHash(name,hash,'const safe = false;\n'),/changed: review/);
    assert.doesNotThrow(()=>assertPinnedSourceHash(name,RETAINED_SOURCE_SHA256[name]));
    assert.throws(()=>assertPinnedSourceHash(name,hash),/changed: review/);
  }
});

// Every browser object below is synthetic. These tests never launch Chrome,
// request a real map, open a service port, or write an output/profile directory.
function fakeBrowser() {
  class Socket {
    constructor(...args) { this.args = args; this.sent = []; }
    send(value) { this.sent.push(value); }
  }
  class Worker {
    constructor(...args) { this.args = args; this.listeners = []; }
    addEventListener(type, listener) { if (type === 'message') this.listeners.push(listener); }
    emit(data) { for (const listener of this.listeners) listener({ data }); }
  }
  const window = { WebSocket: Socket, Worker };
  vm.runInNewContext(guardSource, { window, URL });
  return window;
}

test('worker diagnostics initialize the parent without pausing and verify worker origin', async () => {
  const calls=[];
  let closed=false;
  const connection={close(){closed=true;},async send(method,params={},sessionId){
    calls.push({method,params,sessionId});
    if(method==='Target.getTargets') return {targetInfos:[{type:'worker',targetId:'worker',parentId:'page',url:''}]};
    if(method==='Target.attachToTarget') return {sessionId:params.targetId};
    if(method==='Runtime.evaluate') return {result:{value:{origin:'https://source-chunk.github.io/chunk-picker-rs3/worker.js',ready:true,nonValids:{Quest:{Blocked:'gate'}}}}};
    return {};
  }};
  const result=await readOriginalWorker('synthetic',{connect:async()=>connection});
  assert.deepEqual(result,{nonValids:{Quest:{Blocked:'gate'}},diagnostic:{available:true,reason:null}});
  const enable=calls.findIndex(c=>c.method==='Target.setAutoAttach' && c.params.autoAttach);
  const evaluate=calls.findIndex(c=>c.method==='Runtime.evaluate');
  assert.ok(enable>=0 && enable<evaluate);
  assert.deepEqual(calls[enable],{method:'Target.setAutoAttach',params:{autoAttach:true,waitForDebuggerOnStart:false,flatten:true},sessionId:'page'});
  assert.equal(calls[evaluate].sessionId,'worker');
  assert.ok(calls.some(c=>c.method==='Target.setAutoAttach' && c.params.autoAttach===false));
  assert.equal(closed,true);
});

test('optional worker diagnostics preserve capture availability on failure or foreign origin', async () => {
  const failed=await readOriginalWorker('synthetic',{connect:async()=>{throw Error('SECRET_TOKEN');}});
  assert.deepEqual(failed,{nonValids:null,diagnostic:{available:false,reason:'Worker inspection unavailable during connection'}});
  for(const value of [{origin:'https://foreign.example/worker.js',ready:true,nonValids:{}},
    {origin:'https://source-chunk.github.io/chunk-picker-rs3/worker.js',ready:true,nonValids:null}]) {
    const result=await readOriginalWorker('synthetic',{connect:async()=>({close(){},async send(method){
      if(method==='Target.getTargets') return {targetInfos:[{type:'worker',targetId:'worker',url:''}]};
      if(method==='Target.attachToTarget') return {sessionId:'worker'};
      if(method==='Runtime.evaluate') return {result:{value}};
      return {};
    }})});
    assert.equal(result.nonValids,null);
    assert.equal(result.diagnostic.available,false);
  }
});

const databaseHosts = ['chunkpickerrs3.firebaseio.com', 'firebaseio.com',
  'project.europe-west1.firebasedatabase.app', 'firebasedatabase.app'];

test('Firebase hostname boundaries cover regional databases and API services', () => {
  const hosts = [...databaseHosts, 'project.firebaseapp.com', 'region-project.cloudfunctions.net',
    'identitytoolkit.googleapis.com', 'securetoken.googleapis.com', 'firestore.googleapis.com',
    'firebaseinstallations.googleapis.com'];
  for (const host of hosts) {
    assert.equal(isFirebaseURL(`https://${host}/path`), true, host);
    assert.equal(isFirebaseURL(`https://${host.toUpperCase()}/path`), true, host);
  }
  for (const host of ['firebaseio.com.evil.example', 'notfirebaseio.com',
    'project.firebasedatabase.app.evil.example', 'identitytoolkit.googleapis.com.evil.example',
    'source-chunk.github.io', 'runescape.wiki']) {
    assert.equal(isFirebaseURL(`https://${host}/path`), false, host);
  }
});

test('HTTP blocks every Firebase mutation method and all GET long-poll frames', () => {
  for (const host of databaseHosts) {
    const base = `https://${host}`;
    assert.equal(shouldBlockRequest(`${base}/maps/qxa/chunks.json`, 'GET'), false);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']) {
      assert.equal(shouldBlockRequest(`${base}/maps/qxa/chunks.json`, method), true, method);
    }
    for (const endpoint of ['/.lp?start=t&ser=1', '/.lp?id=2&d0=WRITE_PAYLOAD',
      '/.lp?disconn=t', '/.settings?value=WRITE_PAYLOAD', '/%2elp?d0=WRITE_PAYLOAD',
      '/.%6cp?d0=WRITE_PAYLOAD', '/.LP?d0=WRITE_PAYLOAD']) {
      assert.equal(shouldBlockRequest(`${base}${endpoint}`, 'GET'), true, endpoint);
    }
  }
  assert.equal(shouldBlockRequest('https://source-chunk.github.io/chunk-picker-rs3/worker.js', 'GET'), false);
});

test('socket protocol permits only explicit read actions and heartbeat', () => {
  assert.equal(readOnlySocketAction('0'), 'heartbeat');
  for (const action of ['q', 'n', 'g']) {
    assert.equal(readOnlySocketAction(JSON.stringify({ t: 'd', d: { r: 1, a: action, b: { p: '/maps/qxa' } } })), action);
  }
  for (const action of ['p', 'm', 'o', 'om', 'oc', 'auth', 'gauth', 'unauth', 's', 'unknown', '']) {
    assert.equal(readOnlySocketAction(JSON.stringify({ t: 'd', d: { a: action, b: { p: '/maps/qxa', d: 'synthetic-write' } } })), null, action);
  }
  for (const data of ['1', '', 'not json', 'null', '{}', '[]', '{"t":"c","d":{"a":"q"}}',
    '[{"t":"d","d":{"a":"q"}},{"t":"d","d":{"a":"p"}}]',
    new ArrayBuffer(8), new Uint8Array([1, 2])]) {
    assert.equal(readOnlySocketAction(data), null);
  }
  const binaryMutation = new TextEncoder().encode('{"t":"d","d":{"a":"p"}}');
  binaryMutation.toString = () => '{"t":"d","d":{"a":"q"}}';
  assert.equal(readOnlySocketAction(binaryMutation), null, 'binary data cannot spoof a read frame through JSON coercion');
});

test('injected guard actually blocks mutation frames on each database hostname', () => {
  const window = fakeBrowser();
  for (const host of databaseHosts) {
    const socket = new window.WebSocket(`wss://${host}/.ws?v=5`, ['synthetic-protocol']);
    const read = '{"t":"d","d":{"a":"q","b":{"p":"/maps/qxa"}}}';
    socket.send('0'); socket.send(read);
    for (const action of ['p', 'm', 'o', 'om', 'oc', 'auth']) socket.send(JSON.stringify({ t: 'd', d: { a: action } }));
    socket.send('malformed'); socket.send(new ArrayBuffer(4));
    assert.deepEqual(socket.sent, ['0', read], host);
    assert.deepEqual(socket.args, [`wss://${host}/.ws?v=5`, ['synthetic-protocol']]);
  }
  assert.equal(window.__parityAudit.socketActions.q, databaseHosts.length);
  assert.equal(window.__parityAudit.blockedSocketActions.p, databaseHosts.length);
  assert.equal(window.__parityAudit.blockedSocketActions.unknown, databaseHosts.length * 2);
  const unrelated = new window.WebSocket('wss://synthetic.example/socket');
  unrelated.send('unrelated protocol');
  assert.deepEqual(unrelated.sent, ['unrelated protocol']);
});

test('worker hook observes current results without consuming other messages', () => {
  const window = fakeBrowser();
  const worker = new window.Worker('synthetic-worker.js');
  worker.emit({ type: 'future', nonValids: { future: true } });
  assert.equal(window.__parityWorkerCurrent, undefined);
  const current = { type: 'current', nonValids: { Quest: { task: 'synthetic reason' } } };
  worker.emit(current);
  assert.equal(window.__parityWorkerCurrent, current);
  worker.emit({ type: 'error', err: { message: 'synthetic worker failure' } });
  assert.deepEqual(Array.from(window.__parityAudit.errors), ['synthetic worker failure']);
});

function snapshotContext() {
  const window = fakeBrowser();
  window.secretToken = 'SECRET_WINDOW_TOKEN';
  window.__parityWorkerCurrent = { nonValids: { Quest: { blocked: 'synthetic access gate' } } };
  return {
    window, document: { querySelectorAll: () => [{ innerText: '[10] Fishing: Fish', querySelector: () => ({ disabled: true }) }] },
    mid: 'qxa', currentVersion: 'synthetic', viewOnly: true,
    tempChunks: { unlocked: { 12342: true }, selected: { 12343: true } }, rules: { F2P: true }, settings: { theme: 'synthetic' },
    activeTasks: { Fishing: { Fish: '10{2}' }, Favorite: { Quest: { QuestA: true }, BiS: { Bronze: 'Melee BiS body' } } },
    globalValids: { Fishing: { Fish: 8, OtherFish: 20 }, Quest: { QuestA: true } }, globalValidsBoosts: { Fishing: { Fish: 2 } },
    chunkInfo: { challenges: { Fishing: { Fish: { Level: 10 }, OtherFish: { Level: 20 } }, Quest: { QuestA: { QP: 1 } }, BiS: { Bronze: { Label: 'Melee' } } } },
    highestCurrent: { Fishing: 'Fish' }, highestOverall: { Fishing: 20 }, highestOverallCompleted: { Fishing: 1 }, bisUpgrades: {},
    completedChallenges: { Quest: { PreviousQuest: true } }, checkedChallenges: { Fishing: { Fish: true } },
    checkedAllTasks: { Fishing: { OtherFish: true } }, backlog: { Fishing: { Deferred: 'reason' } },
    savedPin: 'SECRET_PIN', firebase: { auth: { token: 'SECRET_AUTH_TOKEN' } }, localStorage: { password: 'SECRET_PASSWORD' },
  };
}

test('snapshot preserves favorite identities, raw categories and independent status sets', () => {
  const result = JSON.parse(JSON.stringify(vm.runInNewContext(snapshotExpression, snapshotContext())));
  assert.deepEqual(result.active.map(({ category, rawLabel, favorite }) => ({ category, rawLabel, favorite })), [
    { category: 'Fishing', rawLabel: 'Fish', favorite: false },
    { category: 'Quest', rawLabel: 'QuestA', favorite: true },
    { category: 'BiS', rawLabel: 'Bronze', favorite: true },
  ]);
  assert.equal(result.active[0].value, '10{2}');
  assert.equal(result.active[0].metadata.Level, 10);
  assert.equal(result.possible.find(row => row.rawLabel === 'Fish').value, 8);
  assert.equal(result.possible.some(row => row.rawLabel === 'OtherFish'), true);
  assert.equal(result.active.some(row => row.rawLabel === 'OtherFish'), false);
  assert.equal(result.completed[0].rawLabel, 'PreviousQuest');
  assert.equal(result.checked[0].rawLabel, 'Fish');
  assert.equal(result.fullListChecked[0].rawLabel, 'OtherFish');
  assert.equal(result.backlog[0].rawLabel, 'Deferred');
  assert.deepEqual(result.nonValids, { Quest: { blocked: 'synthetic access gate' } });
  assert.deepEqual(result.domActive, [{ text: '[10] Fishing: Fish', disabled: true }]);
});

test('snapshot projects public gameplay fields and rejects editable mode', () => {
  const context = snapshotContext();
  const result = vm.runInNewContext(snapshotExpression, context);
  assert.doesNotMatch(JSON.stringify(result), /SECRET_|savedPin|secretToken|localStorage|firebase/);
  assert.equal(Object.hasOwn(result, 'window'), false);
  context.viewOnly = false;
  assert.throws(() => vm.runInNewContext(snapshotExpression, context), /view-only/);
});

test('recompute expression uses audited noDisplay flags and retains full builder identities', () => {
  const label = 'Obtain ~|Fish|~ from a creature';
  const context = { viewOnly: true, tempChallengeArrSaved: { Fishing: label }, window: {} };
  const calls = [];
  context.setupCurrentChallenges = (...args) => {
    calls.push(args);
    return [{ [label]: 'Extra', prefix: '[Every Drop]' }];
  };
  assert.equal(vm.runInNewContext(recomputeActiveExpression, context), true);
  assert.deepEqual(calls, [[context.tempChallengeArrSaved, true, true]]);
  assert.equal(context.window.__parityComputedList[0][label], 'Extra');
  context.viewOnly = false;
  assert.throws(() => vm.runInNewContext(recomputeActiveExpression, context), /view-only/);
  assert.equal(calls.length, 1);
});

test('computed HTML extraction inspects a detached element independently of initial displayed rows', () => {
  let detachedHTML;
  const detached = {
    set innerHTML(value) { detachedHTML = value; },
    querySelectorAll(selector) {
      assert.equal(selector, '.challenge');
      return [
        { textContent: 'Recomputed goal', querySelector: () => ({ disabled: true }) },
        { textContent: 'Row without input', querySelector: () => null },
      ];
    },
  };
  const context = {
    challengeArr: ['<div class="challenge">Recomputed goal</div>', '<div>Other</div>'],
    document: {
      createElement(tag) { assert.equal(tag, 'div'); return detached; },
      querySelectorAll() { throw new Error('Initial displayed DOM must remain separate'); },
    },
  };
  const result = JSON.parse(JSON.stringify(vm.runInNewContext(computedHTMLExpression, context)));
  assert.equal(detachedHTML, context.challengeArr.join(''));
  assert.deepEqual(result, [{ text: 'Recomputed goal', disabled: true }, { text: 'Row without input', disabled: null }]);
});

test('unauthorized maps and CLI output escapes fail before browser launch or writes', async () => {
  for (const mapIds of [[], ['qxa', 'qxa'], ['qxb', 'qxb'], ['QXA'], ['other'], ['qxa', '../qxb']]) {
    await assert.rejects(captureOriginal({ mapIds, chrome: 'MUST_NOT_LAUNCH' }), /authorized/);
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (const output of [path.join(root, 'outside.json'), path.join(root, '.local', 'research'),
    path.join(root, '.local', 'research', '..', 'outside.json')]) {
    await assert.rejects(runOriginalParityCli(['--chrome', 'MUST_NOT_LAUNCH', '--output', output]), /Output must stay/);
  }
  for (const argv of [['--unknown', 'value'], ['--maps'], ['--chrome', '--output']]) {
    await assert.rejects(runOriginalParityCli(argv), /Unknown option|Missing option/);
  }
});
