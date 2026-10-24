"""Pending remote-only child launcher; does not alter the immutable e97 guard."""
import hashlib
import json
import os
from pathlib import Path
import sys

SOURCE = Path('/workspace/R103-index-component-measurement')
PYTHON = Path('/opt/codex/runtimes/codex-primary-runtime/dependencies/python/bin/python3.12')
NODE = Path('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node')
GUARD = SOURCE / 'sdk/guard-candidate.py'
DRIVER = SOURCE / 'scripts/perf/r81/full-public-component.r119.mjs'


def digest(path):
    checksum = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            checksum.update(chunk)
    return checksum.hexdigest()


def scrub(environment):
    clean = dict(environment)
    removed = 0
    for key in list(clean):
        if key.startswith(('RS3_', 'NODE_TEST', 'NODE_CHANNEL_')) or key in (
            'NODE_OPTIONS', 'NODE_PATH', 'NODE_V8_COVERAGE'
        ):
            del clean[key]
            removed += 1
    return clean, removed


def main():
    if sys.argv[1:] != ['--root-cloud-go']:
        raise RuntimeError('Pending root cloud GO; this launcher must not run locally')
    checks = [
        (PYTHON, None, 'fa67443527ed9647f760d807e2a38f26340757123e643c4639cf273ed15d5ea7'),
        (NODE, None, 'bc17c508ffeed0ec622934f9b7fa72f8e78da65350e63c3eceb56fa688aa5e12'),
        (GUARD, 19919, 'e97cbbe394ef0d50a90b988a0f9f52eccf05651f4f6334188c63c65c020b452e'),
        (DRIVER, 15779, 'eed16e8329424a3015b437e64173ce2e754ac9157b00f619c4c5f6dd079622f8'),
    ]
    verified = []
    for path, size, expected in checks:
        actual = digest(path)
        if actual != expected or (size is not None and path.stat().st_size != size):
            raise RuntimeError(f'Exact runtime/source pin mismatch: {path.name}')
        verified.append({'name': path.name, 'bytes': path.stat().st_size, 'sha256': actual})
    # Fresh parent, guard directory and product directory; no previous evidence is reused.
    output = Path('/workspace/R119-index-component-native04')
    output.mkdir(exist_ok=False)
    environment, removed = scrub(os.environ)
    (output / 'launch.json').write_text(json.dumps({
        'verified': verified,
        'optionalSelectorsRemoved': removed,
        'mandatoryProxyCASecurityPreserved': True,
        'environmentValuesDisclosed': False,
        'outerHardCapSeconds': 240,
        'guardProductWallSeconds': 220,
        'cleanupReserveSeconds': 20,
        'cpuPolicy': 'immutable guard selects and verifies two allowed CPUs for all threads',
        'memoryPolicy': 'immutable guard samples aggregate owned-tree RSS against 6 GiB',
        'nodeOldSpaceMiB': 4096,
    }, indent=2) + '\n')
    command = [str(PYTHON), '-B', str(GUARD), str(output / 'guard'), '220',
               str(NODE), '--max-old-space-size=4096', str(DRIVER),
               '--authorized-full-public', f'--output-dir={output / "product"}']
    os.chdir(SOURCE)
    os.execve(str(PYTHON), command, environment)


if __name__ == '__main__':
    main()
