// Small source-only IPC seam. App children never inherit controller FD3.
export function appForkOptions(env){const childEnv={...env};for(const key of ['NODE_OPTIONS','NODE_PATH','PERF_STAGE_FD'])delete childEnv[key];return{env:childEnv,execArgv:['--max-old-space-size=768'],stdio:['ignore','ignore','ignore','ipc']};}
export function relayStage(send,kind,value){
 let stage;if(kind==='coverage')stage='browser-ready';
 if(kind==='stage')stage=({'overlay-ready':'overlay-ready','timed-session-ready':'measured-ready','journey-begin':'episode-start','finalization-begin':'cleanup-start','cleanup-complete':'cleanup-end'})[value.event];
 if(kind==='ledger'&&value.status==='scoped-state-pass')stage='episode-end';
 if(stage){if(typeof send!=='function')throw Error('r140-child-ipc');send({type:'r140-stage',stage});}return stage??null;
}
export function waitCancellable(ms,signal,{setTimer=setTimeout,clearTimer=clearTimeout}={}){
 return new Promise((resolve,reject)=>{if(signal.aborted)return reject(Error('r140-child-cancelled'));let timer;const done=()=>{signal.removeEventListener('abort',abort);resolve();},abort=()=>{clearTimer(timer);signal.removeEventListener('abort',abort);reject(Error('r140-child-cancelled'));};timer=setTimer(done,ms);signal.addEventListener('abort',abort,{once:true});});
}
export function parseSessionBudget(text){const b=JSON.parse(text??'null');if(!b||b.timedMs!==1800000||b.finalizationMs!==90000||b.resultReserveMs!==15000||![b.setupMs,b.controllerMs,b.remainingMs].every(x=>Number.isSafeInteger(x)&&x>0)||b.setupMs<30000||b.setupMs>90000||b.setupMs+b.timedMs+b.finalizationMs+b.resultReserveMs>b.remainingMs||b.remainingMs>1980000)throw Error('r140-budget-insufficient');return b;}
export function sameCPUSet(a,b){const parse=text=>{if(typeof text!=='string'||!/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(text.trim()))return null;const values=new Set();for(const part of text.trim().split(',')){const [lo,hi=lo]=part.split('-').map(Number);if(lo>hi||hi>65535||hi-lo>2)return null;for(let n=lo;n<=hi;n++)values.add(n);}const list=[...values].sort((x,y)=>x-y);return list.length===2?JSON.stringify(list):null;};const left=parse(a),right=parse(b);return left!==null&&left===right;}
export function controllerStartBarrier(channel,signal,announce,{setTimer=setTimeout,clearTimer=clearTimeout}={}){
 return new Promise((resolve,reject)=>{let timer;const finish=error=>{clearTimer(timer);channel.off('message',message);signal.removeEventListener('abort',abort);error?reject(error):resolve();},message=m=>{if(m?.type==='r140-start'){if(Object.keys(m).length!==1)return finish(Error('r140-child-ipc'));finish();}},abort=()=>finish(Error('r140-child-cancelled'));if(signal.aborted)return reject(Error('r140-child-cancelled'));channel.on('message',message);signal.addEventListener('abort',abort,{once:true});timer=setTimer(()=>finish(Error('r140-start-timeout')),5000);try{Promise.resolve(announce()).catch(finish);}catch(error){finish(error);}});
}
export function sendStageFlushed(channel,message,{setTimer=setTimeout,clearTimer=clearTimeout}={}){
 return new Promise((resolve,reject)=>{if(typeof channel.send!=='function'||channel.connected===false)return reject(Error('r140-child-ipc'));let settled=false,timer;const done=error=>{if(settled)return;settled=true;clearTimer(timer);error?reject(Error('r140-child-ipc')):resolve();};timer=setTimer(()=>done(Error('timeout')),5000);try{channel.send(message,done);}catch(error){done(error);}});
}
export function waitOwnedChildClose(child,ms,{setTimer=setTimeout,clearTimer=clearTimeout}={}){
 return new Promise(resolve=>{if(child.r140Closed)return resolve(true);let timer;const finish=closed=>{clearTimer(timer);child.off('close',closedEvent);resolve(closed);},closedEvent=()=>finish(true);child.once('close',closedEvent);timer=setTimer(()=>finish(false),ms);});
}
