#!/usr/bin/env python3
"""Export only tracked public Git files, with a content receipt; never mount checkout/.git."""
import argparse
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
from docker_envelope import Blocked, require, tree_manifest

def prepare(checkout, commit, output):
    checkout, output = Path(checkout).resolve(), Path(output).resolve()
    require(re.fullmatch(r'[0-9a-f]{40}', commit) is not None, 'invalid-public-commit')
    require(not output.exists(), 'public-export-output-must-be-fresh')
    # Exact commit, no working-copy files, attributes, credentials, untracked data or inherited environment.
    env = {'PATH': os.defpath, 'LANG': 'C.UTF-8', 'HOME': str(output.parent), 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null'}
    proc = subprocess.run(['git', '-C', str(checkout), 'archive', '--format=tar', commit], env=env, capture_output=True, timeout=30)
    require(proc.returncode == 0 and 0 < len(proc.stdout) <= 300 * 1024**2, 'public-git-archive-failed')
    with tarfile.open(fileobj=io.BytesIO(proc.stdout)) as archive:
        for member in archive.getmembers():
            parts = Path(member.name).parts
            require(not Path(member.name).is_absolute() and '..' not in parts and not member.issym() and not member.islnk(), 'unsafe-public-archive-member')
            require(member.isfile() or member.isdir(), 'special-public-archive-member')
        output.mkdir(mode=0o700)
        archive.extractall(output, filter='data')
    receipt = {'schema': 'public-git-archive-v1', 'commit': commit, 'files': tree_manifest(output)}
    output.with_name(output.name + '.receipt.json').write_text(json.dumps(receipt, sort_keys=True) + '\n')
    return {'schema': 'public-export-v1', 'commit': commit, 'fileCount': len(receipt['files'])}

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--checkout', required=True, type=Path)
    p.add_argument('--commit', required=True)
    p.add_argument('--output', required=True, type=Path)
    a = p.parse_args()
    try:
        print(json.dumps(prepare(a.checkout, a.commit, a.output)))
    except (Blocked, OSError, ValueError):
        print(json.dumps({'schema': 'public-export-v1', 'passed': False, 'reasonCode': 'public-export-failed'}))
        raise SystemExit(1)
