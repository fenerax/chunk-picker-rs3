"""Read-only host preflight: enabled workflow entries must exist in exact published assets."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys
import stat
from accept_case import read_final
KINDS={'one-case':'r116','r125-focus':'r125','r111-scoped-soak':'r111','r135-codec-http':'r135','r131-native':'r131','r138-advisory':'r138','r116-close-diagnostic':'r116-close','r139-body-lifecycle':'r139'}
PIN='6f22fefa782747790e2eaefa01e4e5ea7b557323'
class ClosureError(ValueError):
    def __init__(self,phase='definition',job=None,ordinal=None):
        super().__init__('case-runtime-closure-failed');self.phase=phase;self.job=job;self.ordinal=ordinal

def require(ok):
    if not ok:raise ClosureError()

def raw_bytes(path,limit):
    # O_BINARY preserves exact CRLF bytes on Windows during source-only controls.
    fd=os.open(path,os.O_RDONLY|getattr(os,'O_NOFOLLOW',0)|getattr(os,'O_NONBLOCK',0)|getattr(os,'O_BINARY',0))
    try:
        info=os.fstat(fd);require(stat.S_ISREG(info.st_mode) and info.st_size<=limit)
        raw=os.read(fd,limit+1);require(len(raw)<=limit);return raw
    finally:os.close(fd)

def relative(name):
    require(type(name) is str and '\\' not in name and not PurePosixPath(name).is_absolute() and all(part not in ('','.','..') for part in name.split('/')))
    return name

def enabled_entries(workflow):
    markers=list(re.finditer(r'^  ([a-z0-9-]+):\r?\n',workflow,re.M));entries={}
    for i,match in enumerate(markers):
        block=workflow[match.start():(markers[i+1].start() if i+1<len(markers) else len(workflow))]
        commands=[line for line in block.splitlines() if 'python3 -B "$tool/docker_envelope.py" --execute ' in line and '--entrypoint ' in line]
        if not commands:continue
        if re.search(r'^    if: \$\{\{ false \}\}\s*$',block,re.M):continue
        require(re.search(r'^    if: \$\{\{ success\(\) \}\}\s*$',block,re.M) is not None)
        require(re.search(r'^    needs: controls\s*$',block,re.M) is not None)
        require(len(commands)==1)
        found=re.findall(r'(?:^|\s)--entrypoint ([A-Za-z0-9_./-]+)(?:\s|$)',commands[0]);require(len(found)==1)
        entries[match.group(1)]=relative(found[0])
    require(bool(entries));return entries

def definition(workflow,closure):
    require(closure.get('schema')=='public-case-runtime-closure-v1')
    entries=enabled_entries(workflow);cases=closure.get('cases');require(type(cases) is dict and set(entries)==set(cases))
    for job,entry in entries.items():
        case=cases[job];require(entry==relative(case['entrypoint']))
        assets=case['assets'];require(type(assets) is list and len(assets)>1)
        paths=[relative(row['path']) for row in assets];require(len(paths)==len(set(paths)) and entry in paths)
        require(case['manifestKind']==KINDS.get(job))
        prefix=relative(case['prefix'])+'/'
        require(entry.startswith(prefix))
        require(all(name.startswith(prefix) for name in paths))
        manifest=relative(case['manifest']);require(manifest in paths and str(PurePosixPath(manifest).parent)==prefix[:-1])
        for row in assets:
            require(set(row)=={'path','bytes','sha256'} and type(row['bytes']) is int and 0<row['bytes']<=1048576 and type(row['sha256']) is str and re.fullmatch('[0-9a-f]{64}',row['sha256']))
        require(next(row['sha256'] for row in assets if row['path']==manifest)==case['manifestSha256'])
    return entries

def verify(workflow,closure,reader):
    entries=definition(workflow,closure)
    for job,entry in entries.items():
        case=closure['cases'][job];actual={}
        for ordinal,row in enumerate(case['assets']):
            try:raw=reader(row['path'])
            except (OSError,ValueError,KeyError,TypeError):raise ClosureError('member-read',job,ordinal) from None
            if len(raw)!=row['bytes'] or hashlib.sha256(raw).hexdigest()!=row['sha256']:raise ClosureError('member-bytes',job,ordinal)
            actual[row['path']]=raw
        manifest=json.loads(actual[case['manifest']]);prefix=case['prefix']+'/'
        kind=case['manifestKind']
        if kind=='r116':
            require(type(manifest.get('schemaVersion')) is int and manifest['schemaVersion']==1 and manifest.get('mode')=='r116-frozen-input-v1' and manifest.get('sourceCommit')==PIN)
            require(prefix+relative(manifest['entrypoint'])==entry);rows=manifest['files']
        elif kind=='r116-close':
            require(type(manifest.get('schemaVersion')) is int and manifest['schemaVersion']==1 and manifest.get('mode')=='r116-close-phases-observation-v1' and manifest.get('sourceCommit')==PIN and manifest.get('timingEligibility')=='diagnostic-only')
            require(prefix+relative(manifest['entrypoint'])==entry);rows=manifest['files']
        elif kind=='r111':
            require(manifest.get('schema')=='r111-runtime-source-slice-v4' and manifest.get('sourcePin')==PIN)
            require(entry==prefix+'candidate/harness/run-container-session.mjs');rows=manifest['files']
        elif kind=='r135':
            require(manifest.get('schema')=='r135-http-runtime-manifest-v1' and manifest.get('sourcePin')==PIN)
            require(entry==prefix+'entry.mjs');rows=manifest['files']
        elif kind=='r125':
            require(manifest.get('schema')=='r125-compatible-source-manifest-v5' and manifest.get('sourcePin')==PIN and manifest.get('entrypoint')==entry)
            members={}
            for group in ('runtimeFiles','unchangedOriginalPayload'):
                require(type(manifest.get(group)) is dict)
                for name,pin in manifest[group].items():
                    require(name not in members or members[name]==pin);members[name]=pin
            members['bundle-manifest.json']=manifest['publicationFiles']['bundle-manifest.json']
            rows=[{'path':name,**pin} for name,pin in members.items()]
        elif kind=='r131':
            require(manifest.get('schema')=='r131-required-runtime-assets-v1' and manifest.get('sourceCommit')==PIN)
            require(prefix+relative(manifest['entry'])==entry);rows=manifest['files']
        elif kind=='r138':
            require(manifest.get('schema')=='r138-required-runtime-assets-v1' and manifest.get('sourceCommit')==PIN and manifest.get('candidateCommit')=='157e16614bcd248df96070a4c3482e0691b18594')
            require(prefix+relative(manifest['entry'])==entry);rows=manifest['files']
        elif kind=='r139':
            require(manifest.get('schema')=='r139-required-runtime-assets-v1' and manifest.get('sourcePin')==PIN)
            require(prefix+relative(manifest['entry'])==entry);rows=manifest['files']
        else:raise ValueError('case-runtime-closure-failed')
        wanted={row['path']:row for row in case['assets'] if row['path']!=case['manifest']}
        require(type(rows) is list and len(rows)==len(wanted))
        seen=set()
        for row in rows:
            name=prefix+relative(row['path']);require(name not in seen);seen.add(name)
            require(wanted.get(name)=={'path':name,'bytes':row['bytes'],'sha256':row['sha256']})
        require(seen==set(wanted))
    return len(entries)

def main(argv=None):
    args=sys.argv[1:] if argv is None else argv;passed=False;count=0;phase='arguments';job=None;ordinal=None
    try:
        require(len(args)==6 and args[0]=='--workflow' and args[2]=='--map' and args[4]=='--harness')
        phase='workflow-read';workflow=raw_bytes(Path(args[1]),131072).decode('utf8')
        phase='closure-map-read';closure=read_final(args[3]);root=Path(args[5]).resolve(strict=True)
        def reader(name):
            path=root/relative(name);require(not path.is_symlink() and root in path.resolve(strict=True).parents)
            return raw_bytes(path,1048576)
        phase='asset-closure';count=verify(workflow,closure,reader);passed=True
    except ClosureError as error:phase=error.phase;job=error.job;ordinal=error.ordinal
    except (OSError,ValueError,KeyError,TypeError,IndexError):pass
    print(json.dumps({'schema':'public-case-runtime-closure-result-v1','passed':passed,'enabledCases':count,'reasonCode':None if passed else 'case-runtime-closure-failed','failurePhase':None if passed else phase,'job':job,'memberOrdinal':ordinal}))
    return 0 if passed else 1

if __name__=='__main__':sys.exit(main())
