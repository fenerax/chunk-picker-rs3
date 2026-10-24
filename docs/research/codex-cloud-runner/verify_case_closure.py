"""Read-only host preflight: enabled workflow entries must exist in exact published assets."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys
from accept_case import read_final
from docker_envelope import bounded_bytes,Blocked

def require(ok):
    if not ok:raise ValueError('case-runtime-closure-failed')

def relative(name):
    require(type(name) is str and '\\' not in name and not PurePosixPath(name).is_absolute() and all(part not in ('','.','..') for part in name.split('/')))
    return name

def enabled_entries(workflow):
    markers=list(re.finditer(r'^  ([a-z0-9-]+):\n',workflow,re.M));entries={}
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
        prefix=str(PurePosixPath(entry).parent)+'/'
        require(all(name.startswith(prefix) for name in paths))
        manifest=relative(case['manifest']);require(manifest in paths and str(PurePosixPath(manifest).parent)==str(PurePosixPath(entry).parent))
        for row in assets:
            require(set(row)=={'path','bytes','sha256'} and type(row['bytes']) is int and 0<row['bytes']<=1048576 and type(row['sha256']) is str and re.fullmatch('[0-9a-f]{64}',row['sha256']))
        require(next(row['sha256'] for row in assets if row['path']==manifest)==case['manifestSha256'])
    return entries

def verify(workflow,closure,reader):
    entries=definition(workflow,closure)
    for job,entry in entries.items():
        case=closure['cases'][job];actual={}
        for row in case['assets']:
            raw=reader(row['path']);require(len(raw)==row['bytes'] and hashlib.sha256(raw).hexdigest()==row['sha256']);actual[row['path']]=raw
        manifest=json.loads(actual[case['manifest']]);require(manifest.get('schema')=='r131-required-runtime-assets-v1' and manifest.get('sourceCommit')=='6f22fefa782747790e2eaefa01e4e5ea7b557323')
        prefix=str(PurePosixPath(entry).parent)+'/'
        require(prefix+relative(manifest['entry'])==entry)
        wanted={row['path']:row for row in case['assets'] if row['path']!=case['manifest']}
        rows=manifest['files'];require(type(rows) is list and len(rows)==len(wanted))
        seen=set()
        for row in rows:
            name=prefix+relative(row['path']);require(name not in seen);seen.add(name)
            require(wanted.get(name)=={'path':name,'bytes':row['bytes'],'sha256':row['sha256']})
        require(seen==set(wanted))
    return len(entries)

def main(argv=None):
    args=sys.argv[1:] if argv is None else argv;passed=False;count=0
    try:
        require(len(args)==6 and args[0]=='--workflow' and args[2]=='--map' and args[4]=='--harness')
        workflow=bounded_bytes(Path(args[1]),131072).decode('utf8')
        closure=read_final(args[3]);root=Path(args[5]).resolve(strict=True)
        def reader(name):
            path=root/relative(name);require(not path.is_symlink() and root in path.resolve(strict=True).parents)
            return bounded_bytes(path,1048576)
        count=verify(workflow,closure,reader);passed=True
    except (OSError,ValueError,KeyError,TypeError,IndexError,Blocked):pass
    print(json.dumps({'schema':'public-case-runtime-closure-result-v1','passed':passed,'enabledCases':count,'reasonCode':None if passed else 'case-runtime-closure-failed'}))
    return 0 if passed else 1

if __name__=='__main__':sys.exit(main())
