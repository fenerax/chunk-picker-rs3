import { arrivals } from './scheduler.mjs';
import { integer } from './model.mjs';

export function validateSustained(profile, format = 'format1') {
  if (!['format1', 'format2'].includes(format)) throw new Error('Use --format format1 or format2.');
  if (format === 'format2') throw new Error('Format 2 HTTP serving is blocked on activation slice 7c. See docs/perf/sustained-load.md; no fixture or server was started.');
  if (!profile.sustained) return;
  if (profile.rotationSeconds != null) throw new Error('Sustained cohorts must stay fixed.');
  const duration = profile.stages.reduce((n, stage) => n + stage.seconds, 0);
  const settings = profile.sustained;
  for (const key of ['restartAtSeconds', 'reconnectSeconds', 'recoveryDeadlineSeconds', 'recoveryPollSeconds']) integer(settings[key], 1, 86400, key);
  if (settings.restartAtSeconds >= duration - settings.recoveryDeadlineSeconds) throw new Error('Leave a complete recovery window after restart.');
  if (profile.stages[0]?.name !== 'cold-open' || profile.stages[0].browserPerSecond || profile.stages[0].pluginPerSecond) throw new Error('Start with a separate staggered cold-open phase.');
  if (settings.restartAtSeconds <= profile.stages[0].seconds) throw new Error('Restart must follow cold opens.');
}

// Product arrivals, plugin polls and reconnects all depend on workload time,
// never completion time. HTTP amplification remains in each action receipt.
export function sustainedArrivals(profile, cohorts) {
  const events = arrivals(profile.stages, profile.seed, stage => ({
    read: stage.browserPerSecond * .5, taskRead: stage.browserPerSecond * .2,
    edit: stage.browserPerSecond * .15, switch: stage.browserPerSecond * .05,
    heavy: stage.browserPerSecond / 12, undo: stage.browserPerSecond / 60,
    pluginReport: stage.pluginPerSecond * .4, pluginStatus: stage.pluginPerSecond * .4,
    pluginTasks: stage.pluginPerSecond * .2, sync: stage.syncPerMinute / 60,
  }));
  const first = cohorts.get('0:0'), representatives = [...new Map(first.map(client => [client.group, client])).values()];
  const coldSeconds = profile.stages[0].seconds;
  for (const [ordinal, client] of representatives.entries()) events.push({kind:'cold-open',stage:0,ordinal,
    clientIndex:first.findIndex(row=>row.cookie===client.cookie),atMs:ordinal * coldSeconds * 1000 / representatives.length});
  let offset = 0;
  for (const [stage, settings] of profile.stages.entries()) {
    if (stage) for (const [clientIndex] of cohorts.get(`${stage}:0`).entries()) {
      const phase = clientIndex * profile.sustained.reconnectSeconds * 1000 / settings.users;
      for (let atMs = offset + phase + profile.sustained.reconnectSeconds * 1000; atMs < offset + settings.seconds * 1000; atMs += profile.sustained.reconnectSeconds * 1000)
        events.push({kind:'reconnect',stage,clientIndex,atMs});
    }
    offset += settings.seconds * 1000;
  }
  const restartMs = profile.sustained.restartAtSeconds * 1000;
  const stageAt = atMs => { let end = 0; return profile.stages.findIndex(stage => (end += stage.seconds * 1000) > atMs); };
  events.push({kind:'restart',stage:stageAt(restartMs),atMs:restartMs});
  const pool = cohorts.get(`${stageAt(restartMs)}:0`);
  const groups = [...new Map(pool.map(client => [client.group,client])).values()];
  for (let poll = 0; poll < profile.sustained.recoveryDeadlineSeconds; poll += profile.sustained.recoveryPollSeconds)
    for (const [ordinal, client] of groups.entries()) {
      const atMs = restartMs + (poll + ordinal * profile.sustained.recoveryPollSeconds / groups.length) * 1000;
      events.push({kind:'recovery-open',stage:stageAt(atMs),clientIndex:pool.findIndex(row=>row.cookie===client.cookie),atMs});
    }
  events.push({kind:'workload-end',stage:profile.stages.length-1,atMs:offset});
  return events.map(event=>event.kind==='heavy'?{...event,actionIndex:event.ordinal+Math.floor(event.ordinal/profile.stages[event.stage].activeGroups)}:event).sort((a,b)=>a.atMs-b.atMs);
}

export function sustainedPhase(profile, atMs) {
  if (!profile.sustained) return null;
  if (atMs < profile.stages[0].seconds * 1000) return 'cold-open';
  const restart = profile.sustained.restartAtSeconds * 1000;
  if (atMs < restart) return 'before-restart';
  if (atMs < restart + profile.sustained.recoveryDeadlineSeconds * 1000) return 'restart-recovery';
  return 'after-recovery';
}

export function sustainedAction(event) {
  const index = event.ordinal ?? 0;
  if (event.kind === 'read') return index % 5 < 3 ? 'state' : 'history';
  if (event.kind === 'taskRead') return ['task-view','task-view','group-task-view','how','why'][index % 5];
  if (event.kind === 'edit') return ['note','tick','undo'][index % 3];
  if (event.kind === 'heavy') return ['task-miss','preview','task-miss','roll-accept','preview','task-miss','pool-undo','preview','task-miss','roll-accept'][(event.actionIndex??index) % 10];
  return event.kind;
}

export async function sustainedBrowserAction({call,client,event,chunks,explainAction,prepareRollSnapshot}) {
  const action = sustainedAction(event);
  if (action === 'switch') throw Object.assign(new Error('Character switch API is not implemented.'), {status:'unsupported'});
  if (action === 'state' || action === 'history') return call(client,action === 'state' ? '/api/state?view=play-v1' : '/api/history?limit=20');
  if (action === 'task-view') return call(client,`/api/tasks?memberId=${client.memberId}&view=play-v1`);
  if (action === 'how' || action === 'why') return explainAction(call,client,action,event.id);
  let snapshot = await call(client,'/api/state?view=play-v1');
  const state = snapshot.state, member = state.members.find(row=>row.id===client.memberId);
  if (action === 'group-task-view') {
    const peer = client.peers.find(id=>id!==client.memberId);
    return call(client,`/api/tasks?memberId=${client.memberId}&view=play-v1${peer?`&lane=duo-v1&peerFor=${peer}&revision=${state.revision}`:''}`);
  }
  const command = command => call(client,'/api/command?view=play-v1',{expectedRevision:state.revision,command});
  if (action === 'note') return command({type:'set-note',memberId:client.memberId,chunkId:chunks[event.id%chunks.length],note:`Synthetic sustained ${event.id}`});
  if (action === 'tick') {
    const taskId = client.taskIds[event.id%client.taskIds.length];
    return command({type:'complete-task',memberId:client.memberId,taskId,completed:!member.completedTasks.includes(taskId)});
  }
  if (action === 'undo') {
    const target = state.history?.findLast(row=>row.undo&&row.undoneRevision===undefined&&row.type!=='undo');
    if (target) return command({type:'undo',undoRevision:target.revision});
    // A fresh map has no enabled Undo yet. Establish a real reversible edit;
    // include both acknowledgements in this action rather than send invalid work.
    const edited = await command({type:'set-note',memberId:client.memberId,chunkId:chunks[event.id%chunks.length],note:`Synthetic Undo preparation ${event.id}`});
    return call(client,'/api/command?view=play-v1',{expectedRevision:edited.state.revision,command:{type:'undo',undoRevision:edited.state.revision}});
  }
  if (action === 'task-miss') {
    // Do not alternate two cached rule states. Each pass gives the group a new
    // skill input for this 30-minute run. Plugin Mining reports cannot reset it.
    const pass = Math.floor(event.ordinal / event.activeGroups);
    await command({type:'set-skill-levels',memberId:client.memberId,skill:'Attack',passiveLevel:2+pass%90});
    return call(client,`/api/tasks?memberId=${client.memberId}&view=play-v1`);
  }
  snapshot = await prepareRollSnapshot(call,client,snapshot,chunks);
  const eligible = snapshot.pools?.[client.memberId]?.eligible ?? [];
  const candidate = eligible[event.ordinal % Math.max(1,eligible.length)]?.id;
  if (!candidate) throw Object.assign(new Error('Empty roll pool.'),{status:'empty-pool'});
  if (action === 'preview') return call(client,`/api/predict?memberId=${client.memberId}&chunkId=${candidate}`);
  const count = action === 'roll-accept' && eligible.length >= 2 ? 2 : 1;
  let result = await call(client,'/api/command?view=play-v1',{expectedRevision:snapshot.state.revision,command:{type:'roll',memberId:client.memberId,count}});
  if (count === 2) result = await call(client,'/api/command?view=play-v1',{expectedRevision:result.state.revision,command:{type:'pick-for-me',memberId:client.memberId}});
  if (action === 'pool-undo') await call(client,'/api/command?view=play-v1',{expectedRevision:result.state.revision,command:{type:'undo'}});
}
