"""docker-hard-2cpu-6g-v1; pending functional entry, NOT e97 or a latency protocol."""
import hashlib,json,os,pathlib,re,shutil,signal,subprocess,tempfile,time
PROTOCOL='docker-hard-2cpu-6g-v1'
NAME='native later-page focus across held ack: group=false, owner=alpha'
HERE=pathlib.Path('/harness'); SOURCE=pathlib.Path('/source'); SCRATCH=pathlib.Path('/scratch')
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
def require(ok,msg):
 if not ok:raise RuntimeError(msg)
def tree(root):
 records=[]
 for p in root.rglob('*'):
  rel=p.relative_to(root)
  if '.git' in rel.parts:continue
  require(not p.is_symlink(),'source symlink rejected')
  if p.is_file():records.append((rel.as_posix(),sha(p)))
 h=hashlib.sha256()
 for name,digest in sorted(records):h.update(name.encode()+b'\0'+bytes.fromhex(digest))
 return {'files':len(records),'sha256':h.hexdigest()}
def stage(name,status):print(json.dumps({'schema':'r125-stage-v1','stage':name,'status':status},separators=(',',':')),flush=True)
def readonly_mount(p):
 # Exact dedicated mounts required, no inference from a merely unwritable file.
 for line in pathlib.Path('/proc/self/mountinfo').read_text().splitlines():
  fields=line.split()
  if fields[4]==str(p):return 'ro' in fields[5].split(',')
 return False
def run():
 SCRATCH.mkdir(exist_ok=True); out=SCRATCH/'case-result.json'
 require(not out.exists(),'exclusive output required')
 result={'schema':'r125-case-result-v1','protocol':PROTOCOL,'runtime':'UNRUN','nativeAssertions':'MISSING','coverage':'MISSING','cleanup':'MISSING','processExit':None,'scope':'one instrumented Alpha Personal functional race; no timing/SLO or reliability claim'}
 proc=None; workspace=None
 try:
  manifest=json.loads((HERE/'bundle-manifest.json').read_text())
  require(os.getuid()!=0,'nonroot required')
  require(os.environ.get('R125_CONTAINER_GO')=='root-reviewed-docker-hard','root container admission absent')
  require(re.fullmatch(r'.+@sha256:[0-9a-f]{64}',os.environ.get('R125_IMAGE_DIGEST','')) is not None,'pinned image digest required')
  for p in [SOURCE,HERE,pathlib.Path('/deps'),pathlib.Path('/runtime/node')]:require(readonly_mount(p),'dedicated readonly mount required: '+str(p))
  require(pathlib.Path('/sys/fs/cgroup/memory.max').read_text().strip()==str(6*1024**3),'6GiB hard memory cap required')
  require(pathlib.Path('/sys/fs/cgroup/memory.swap.max').read_text().strip()=='0','memory+swap=6GiB requires zero additional swap')
  quota,period=map(int,pathlib.Path('/sys/fs/cgroup/cpu.max').read_text().split());require(quota==2*period,'2CPU hard quota required')
  require(len(os.sched_getaffinity(0))==2,'exact twoCPU affinity required')
  require(sorted(p.name for p in pathlib.Path('/sys/class/net').iterdir())==['lo'],'network-none required')
  require(pathlib.Path('/proc/1/comm').read_text().strip() in ['docker-init','tini'],'container init/reaping required')
  for key in ['NODE_OPTIONS','NODE_PATH','NODE_V8_COVERAGE']:require(not os.environ.get(key),'unadmitted Node hook: '+key)
  require(tree(SOURCE)==manifest['publicSourceTreeDigest'],'original public source identity differs')
  for name,record in manifest['payload'].items():require(sha(HERE/name)==record['sha256'],'payload hash differs: '+name)
  node='/runtime/node'; pw=pathlib.Path('/deps/node_modules/playwright/index.mjs'); chrome=pathlib.Path('/deps/browsers/chromium-1234/chrome-linux64/chrome')
  require(subprocess.check_output([node,'--version'],text=True,timeout=5).strip()=='v24.19.0','Node version differs')
  require(json.loads(pw.with_name('package.json').read_text())['version']=='1.62.1','Playwright differs')
  browsers=json.loads(pathlib.Path('/deps/node_modules/playwright-core/browsers.json').read_text())['browsers']
  require(any(b['name']=='chromium' and str(b['revision'])=='1234' and b['browserVersion']=='151.0.7922.34' for b in browsers),'browser package identity differs')
  require('151.0.7922.34' in subprocess.check_output([str(chrome),'--version'],text=True,timeout=5),'actual Chromium version differs')
  result['identity']={'imageDigest':os.environ['R125_IMAGE_DIGEST'],'nodeSHA256':sha(pathlib.Path(node)),'chromiumSHA256':sha(chrome),'playwright':'1.62.1','chromium':'151.0.7922.34','revision':'1234'}
  stage('admission','PASS')
  workspace=pathlib.Path(tempfile.mkdtemp(prefix='r125-',dir=SCRATCH)); app=workspace/'source';shutil.copytree(SOURCE,app,ignore=shutil.ignore_patterns('.git'))
  patch=HERE/'candidate/production.patch'
  subprocess.run(['git','apply','--check',str(patch)],cwd=app,check=True,timeout=10)
  subprocess.run(['git','apply',str(patch)],cwd=app,check=True,timeout=10)
  for name,expected in manifest['candidateApplicationFiles'].items():require(sha(app/name)==expected,'candidate application bytes differ: '+name)
  for name in manifest['r109InstalledFiles']:
   target=app/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(HERE/name,target)
  # Old e97 launcher is retained as public provenance only and is never invoked.
  stage('scratch-install','PASS')
  env=dict(os.environ)
  for key in list(env):
   if key.startswith(('RS3_','NODE_TEST_','R78_')) or key in ['NODE_CHANNEL_FD','NODE_CHANNEL_SERIALIZATION_MODE']:del env[key]
  env.update(R78_NATIVE='1',R78_PLAYWRIGHT=str(pw),R78_CHROMIUM=str(chrome),R78_SCRATCH=str(workspace/'fixture-'),RS3_DATASET='duo-legacy',RS3_TASK_WORKER_MODE='process',NODE_DISABLE_COLORS='1')
  command=[node,'--max-old-space-size=768','--test-reporter=spec','--test-name-pattern=^'+NAME+'$','tests/task-focus-native.test.mjs']
  log=workspace/'native-private.log';result['runtime']='STARTED';stage('native','STARTED')
  with log.open('wb') as stream:
   proc=subprocess.Popen(command,cwd=app,env=env,stdout=stream,stderr=subprocess.STDOUT,start_new_session=True)
   try:code=proc.wait(timeout=180)
   except subprocess.TimeoutExpired:
    os.killpg(proc.pid,signal.SIGTERM)
    try:proc.wait(timeout=2)
    except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait(timeout=2)
    raise RuntimeError('native independent180s deadline')
  result['processExit']=code;require(log.stat().st_size<=1048576,'native output cap')
  text=re.sub(r'\x1b\[[0-9;]*m','',log.read_text())
  tags={}
  for tag in ['r109-native-witness','r109-command-proof','r109-fixture-drain']:
   lines=[line[len(tag)+1:] for line in text.splitlines() if line.startswith(tag+' ')]
   require(len(lines)==1,'exact evidence absent: '+tag);tags[tag]=json.loads(lines[0])
  named=len(re.findall(r'^✔ '+re.escape(NAME)+r' \(',text,re.M))==1
  counts=all(re.search(r'^ℹ '+label+' '+str(n)+r'\s*$',text,re.M) for label,n in [('tests',1),('pass',1),('fail',0),('cancelled',0),('skipped',0)])
  witness=tags['r109-native-witness']; proof=tags['r109-command-proof'];drain=tags['r109-fixture-drain']
  # Full oracle asserts exact natural body/WeakMap/claim/consumer/current/cached+
  # fresh generation and real slice before B insertion. Do not create fallback
  # evidence or manufacture workload when any branch is missing.
  result['nativeAssertions']='PASS' if named and counts and proof.get('owner')=='alpha' and proof.get('group') is False else 'FAIL'
  joined=witness.get('witness',{}); row=joined.get('row',{}); slice_=joined.get('slice',{}); render=joined.get('render',{}); accepted=joined.get('accepted',{})
  covered=bool(joined.get('cached')) and bool(row) and bool(slice_) and row.get('generation')==slice_.get('generation')==render.get('generation') and slice_.get('next',10**9)<=row.get('index',-1) and accepted.get('response',{}).get('id')==render.get('responseId')
  result['coverage']='PASS' if named and counts and witness.get('owner')=='alpha' and witness.get('group') is False and covered else 'FAIL'
  result['cleanup']='PASS' if drain.get('drained') and drain.get('graceful') and not drain.get('forced') and not drain.get('error') else 'FAIL'
  result['evidence']={'namedPassCount':int(named),'actualCountsMatch':bool(counts),'owner':proof.get('owner'),'commandCount':len(proof.get('commands',[])),'historyCount':len(proof.get('history',[])),'fixtureDrained':bool(drain.get('drained')),'fixtureGraceful':bool(drain.get('graceful'))}
  require(code==0 and all(result[k]=='PASS' for k in ['nativeAssertions','coverage','cleanup']),'functional acceptance failed')
  result['runtime']='COMPLETED';stage('native','PASS')
 except Exception as error:
  # Never copy raw logs, task bodies, request/session identifiers or stores into
  # portable results. Exact assertion stacks stay in owned scratch for review.
  result['runtime']='FAILED' if result['runtime']=='STARTED' else result['runtime'];result['failureClass']=type(error).__name__;stage('case','FAIL')
 finally:
  try:result['originalSourceUnchanged']=tree(SOURCE)==json.loads((HERE/'bundle-manifest.json').read_text())['publicSourceTreeDigest']
  except Exception:result['originalSourceUnchanged']=False
  # An init container plus external hard removal owns all process descendants;
  # this receipt does NOT claim the container-level drain from a process exit.
  result['containerDrain']='PENDING_EXTERNAL_INSPECT_AND_REMOVE';result['containerAcceptance']='PENDING_EXTERNAL_RECEIPT'
  out.write_text(json.dumps(result,indent=2)+'\n');stage('result','WRITTEN')
 return 0 if result['runtime']=='COMPLETED' and result.get('originalSourceUnchanged') else 1
if __name__=='__main__':raise SystemExit(run())
