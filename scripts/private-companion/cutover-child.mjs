// Wait for the foreground helper, even when its background child inherits a pipe.
import { spawn } from 'node:child_process';

export function runChild(executable,args,{timeout=300000,maxBuffer=8*1024**2,env=process.env,cwd}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],env,cwd});
    let stdout='',stderr='',failure,timer,done=false;
    const collect=(kind,bytes)=>{
      if(kind==='stdout')stdout+=bytes.toString();else stderr+=bytes.toString();
      if(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)>maxBuffer){failure='CHILD_OUTPUT_LIMIT';child.kill();}
    };
    child.stdout.on('data',bytes=>collect('stdout',bytes));child.stderr.on('data',bytes=>collect('stderr',bytes));
    const finish=(code)=>{
      if(done)return;done=true;clearTimeout(timer);child.stdout.destroy();child.stderr.destroy();
      if(code===0&&!failure)resolve({stdout,stderr});
      else reject(Object.assign(new Error('Foreground helper refused.'),{code:failure??'CHILD_REFUSED',stdout,stderr}));
    };
    child.once('error',()=>finish(1));
    child.once('exit',code=>{
      // Normal children close their pipes immediately. Start-Process can leave a
      // background picker holding inherited pipe handles after PowerShell exits.
      const grace=setTimeout(()=>finish(code),250);
      child.once('close',()=>{clearTimeout(grace);finish(code);});
    });
    timer=setTimeout(()=>{failure='CHILD_TIMEOUT';child.kill();},timeout);
  });
}
