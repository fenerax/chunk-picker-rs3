// Bounded process-lifecycle protocol only. No app, browser or provider imports.
import {bounded} from './harness-utils.mjs';

export const CLOSE_DRIVER_STAGES=Object.freeze([
  'unobserved','ownership-before','application-close','startup-drain','witness-finalize',
  'ownership-after','closed-state-read','complete',
]);
export const CLOSE_ERROR_CODES=Object.freeze([
  'none','unknown','CHILD_RPC_FAILED','CHILD_RPC_TIMEOUT','CHILD_IPC_SEND_FAILED','CHILD_EXITED',
  'CHILD_CLOSE_TIMEOUT','CHILD_KILL_TIMEOUT','IPC_DISCONNECTED','STORE_OWNER_LOCK_REMAINS_AFTER_CLOSE',
  'APP_NOT_READY_OR_CLOSING','EACCES','EPERM','ENOENT','EIO','ENOSPC','ERR_IPC_CHANNEL_CLOSED','ERR_IPC_DISCONNECTED',
]);
export const CLOSE_WITNESS_CODES=Object.freeze([
  'not-checked','closed-witness-verified','close-receipt-incomplete',
  'store-commit-or-capture-error-at-close','finalized-witness-invalid','input-changed-during-close',
]);
const closedError=error=>{
  let value;try{value=error?.message;}catch{}
  return typeof value==='string'&&CLOSE_ERROR_CODES.includes(value)?value:'unknown';
};
const exitCode=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const exitSignal=value=>value===null?'none':['SIGKILL','SIGTERM','SIGABRT','SIGTRAP'].includes(value)?value:typeof value==='string'?'other':'unknown';

/** Stop and wait once. A second cleanup call observes exactly the first result. */
export function createChildCloser({getExit,getStopped,getStoppedCount,getPendingCount,getDriverStage,stop,waitExit,kill,
  clock=()=>performance.now(),limit=bounded}) {
  let promise,finalReceipt;
  const state={attemptStatus:'not-started',stopRpcStatus:'not-attempted',stopErrorCode:'none',
    exitWaitStatus:'not-attempted',exitWaitErrorCode:'none',witnessCode:'not-checked',
    receiptStatus:'missing',elapsedMs:null};
  return {
    close(){return promise??=(async()=>{
      const started=clock();let result=null,graceful=true;state.attemptStatus='started';
      try{
        if(!getExit()){
          try{result=await stop();finalReceipt=result;state.stopRpcStatus='acknowledged';
            state.receiptStatus=result&&typeof result==='object'?'present':'missing';}
          catch(error){graceful=false;state.stopRpcStatus='rejected';state.stopErrorCode=closedError(error);}
        }
        if(!getExit()){
          try{await limit(waitExit,2000,'CHILD_CLOSE_TIMEOUT');state.exitWaitStatus='normal-exit';}
          catch(error){
            graceful=false;state.exitWaitStatus='timed-out-kill-attempted';state.exitWaitErrorCode=closedError(error);
            kill('SIGKILL');
            try{await limit(waitExit,3000,'CHILD_KILL_TIMEOUT');}
            catch(killError){state.exitWaitStatus='kill-timeout';state.exitWaitErrorCode=closedError(killError);throw killError;}
          }
        }else state.exitWaitStatus='already-exited';
        // stopped is the IPC envelope; canonical final is always its receipt.
        const final=result??getStopped()?.result??null;
        finalReceipt=final;
        state.receiptStatus=final&&typeof final==='object'?'present':'missing';
        state.attemptStatus='complete';
        return {graceful,exit:getExit(),final};
      }catch(error){state.attemptStatus='failed';throw error;}
      finally{state.elapsedMs=Math.max(0,Math.ceil(clock()-started));}
    })();},
    witness(code){state.witnessCode=CLOSE_WITNESS_CODES.includes(code)?code:'not-checked';},
    diagnostic(){
      const exit=getExit(),stage=getDriverStage();
      const bool=value=>value===true?'yes':value===false?'no':'unobserved';
      const count=value=>Array.isArray(value)?value.length:null;
      return {...state,exitCode:exitCode(exit?.code),exitSignal:exitSignal(exit?.signal),
        stoppedMessageCount:getStoppedCount(),pendingRpcCount:getPendingCount(),
        closeCompleted:bool(finalReceipt?.closeCompleted),ownershipStable:bool(finalReceipt?.ownershipStable),
        ownerLockPresent:bool(finalReceipt?.ownershipAfterClose?.present),
        journalCount:count(finalReceipt?.journal),captureErrorCount:count(finalReceipt?.captureErrors),
        witnessCount:count(finalReceipt?.witnesses),validWitnessCount:Array.isArray(finalReceipt?.witnesses)
          ?finalReceipt.witnesses.filter(w=>w?.valid===true&&w?.provisional===false).length:null,
        driverStage:CLOSE_DRIVER_STAGES.includes(stage)?stage:'unobserved'};
    },
  };
}

// Cleanup still fails acceptance; it must not erase the initiating exception.
export function applyCleanupFailure(result,code='cleanup-incomplete') {
  result.status='failed';
  if(!result.failureOperation)result.code=code;
}
