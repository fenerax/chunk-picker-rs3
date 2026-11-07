import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { openSync, writeSync, closeSync, rmSync, existsSync } from 'node:fs';

function mailbox() {
  const queued=[],waiting=[];
  return {
    send:value=>waiting.length?waiting.shift()(value):queued.push(value),
    next:()=>queued.length?Promise.resolve(queued.shift()):new Promise(resolve=>waiting.push(resolve)),
  };
}

// A real exclusively owned file, with each asynchronous filesystem phase
// acknowledged by the test. No sleeps, polling, cleanup retries or real faults.
export class ControlledDatasetDestination extends Writable {
  opening=mailbox();writing=mailbox();flushing=mailbox();closing=mailbox();
  chunks=[];
  constructor(path,options) {
    super({highWaterMark:1});
    assert.deepEqual(options,{flags:'wx'});
    this.path=path;
  }
  _construct(callback) {
    this.acknowledgeOpen=()=>{
      if(this.openAcknowledged)return;
      this.openAcknowledged=true;
      try {this.fd=openSync(this.path,'wx');callback();}catch(e){callback(e);}
    };
    this.opening.send(this.acknowledgeOpen);
  }
  _write(chunk,encoding,callback) {
    this.chunks.push(Buffer.from(chunk));
    this.writing.send((error)=>{
      if(!error)writeSync(this.fd,chunk);
      callback(error);
    });
  }
  _final(callback) {this.flushing.send(callback);}
  _destroy(error,callback) {
    this.acknowledgeClose=()=>{
      if(this.closeAcknowledged)return;
      this.closeAcknowledged=true;
      if(this.fd!==undefined){closeSync(this.fd);this.fd=undefined;}
      callback(error);
    };
    this.closing.send(this.acknowledgeClose);
  }
  async drainUntilFinal() {
    // Stop at the explicit final acknowledgement, not at queue emptiness.
    const final=this.flushing.next().then(ack=>({ack}));
    while(true) {
      const event=await Promise.race([this.writing.next().then(write=>({write})),final]);
      if(event.ack)return event.ack;
      event.write();
    }
  }
  removeDirectory(dir) {
    assert.equal(this.closed,true,'directory removal requires destination close');
    assert.equal(this.fd,undefined,'directory removal requires file-handle close');
    rmSync(dir,{recursive:true});
    assert.equal(existsSync(dir),false);
  }
}

export function observeClosed(promise,destination) {
  return promise.then(
    value=>{assert.equal(destination.closed,true,'operation resolved before destination close');return value;},
    error=>{assert.equal(destination.closed,true,'operation rejected before destination close');throw error;},
  );
}

export async function assertPending(promise) {
  // A microtask sentinel only inspects settlement at an acknowledged phase.
  // It never joins a writer or authorizes filesystem cleanup.
  const pending=Symbol('pending');
  assert.equal(await Promise.race([promise,Promise.resolve(pending)]),pending);
}
