"""Pending cloud entry only. No application imports; fail closed before Node."""
import argparse, hashlib, json, os, pathlib, re, subprocess, sys, time

GUARD_SHA = 'e97cbbe394ef0d50a90b988a0f9f52eccf05651f4f6334188c63c65c020b452e'
NODE_SHA = 'bc17c508ffeed0ec622934f9b7fa72f8e78da65350e63c3eceb56fa688aa5e12'
CHROMIUM_SHA = '4dc9f9f9b20e9bd95bf201f43d2d643f48938f36a70ddcb6fce3dd611a178180'
NAME = 'native later-page focus across held ack: group=false, owner=alpha'
PIN = '6f22fefa782747790e2eaefa01e4e5ea7b557323'

def digest(filename):
    value = hashlib.sha256()
    with open(filename, 'rb') as stream:
        for part in iter(lambda: stream.read(1024 * 1024), b''): value.update(part)
    return value.hexdigest()

def require(condition, message):
    if not condition: raise RuntimeError(message)

def generation(pid):
    try:
        text = pathlib.Path(f'/proc/{pid}/stat').read_text()
        parts = text[text.rfind(')') + 2:].split()
        return {'pid': int(text.split(' ', 1)[0]), 'start': int(parts[19]),
                'namespace': os.readlink(f'/proc/{pid}/ns/pid')}
    except FileNotFoundError: return None

def main():
    require(os.environ.get('R109_NATIVE_GO') == 'root-reviewed-functional', 'UNRUN: root functional GO required')
    parser = argparse.ArgumentParser()
    parser.add_argument('--guard', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    root = pathlib.Path(__file__).resolve().parent.parent
    manifest = json.loads((root / 'tests/task-focus-native.manifest.json').read_text())
    require(manifest['sourcePin'] == PIN, 'source admission pin differs')
    for name, expected in manifest['harnessFiles'].items():
        require(digest(root / name) == expected['sha256'], f'harness hash differs: {name}')
    for name, expected in manifest['applicationFiles'].items():
        require(digest(root / name) == expected, f'public/v3 application bytes differ: {name}')
    # Unknown Node hooks may be required by the executor. Reject; never conceal
    # them by stripping mandatory security configuration after they have run.
    for name in ['NODE_OPTIONS', 'NODE_PATH', 'NODE_V8_COVERAGE']:
        require(not os.environ.get(name), f'{name} needs explicit runtime admission before this launch')
    require(not os.environ.get('RS3_WORKER_MEMORY_PROBE_IMPORT'), 'worker executable probe hook needs explicit admission')
    selectors = {'RS3_DATASET', 'RS3_TASK_WORKER_MODE', 'RS3_DATASET_PROFILE', 'RS3_DATASET_PROFILE_SHA256',
        'RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_PRIVATE_ADDON', 'RS3_PRIVATE_ADDON_SHA256',
        'RS3_PERF_STATE', 'RS3_PERF_COMPANION_ROOT', 'RS3_GAME_DATA_DIR', 'RS3_MAP_ASSETS_DIR',
        'RS3_TERRAIN_ASSETS_DIR', 'RS3_ICON_ASSETS_DIR', 'RS3_WORLD_IMAGES_ROOT', 'RS3_PUBLIC_ORIGIN',
        'RS3_LOOPBACK_PORT', 'RS3_RESOURCE_CONTENTS', 'RS3_ARCHAEOLOGY_CONTENTS', 'RS3_CACHE_SHOP_CONTENTS',
        'RS3_WORKER_MEMORY_PROBE_IMPORT'}
    require(all(name in selectors for name in os.environ if name.startswith('RS3_')), 'unknown RS3 configuration needs admission')
    env = dict(os.environ)
    for name in list(env):
        if name.startswith(('RS3_', 'NODE_TEST_')) or name in ['NODE_CHANNEL_FD', 'NODE_CHANNEL_SERIALIZATION_MODE']:
            del env[name]
    guard = pathlib.Path(args.guard).resolve()
    require(digest(guard) == GUARD_SHA, 'e97 guard hash differs')
    node = pathlib.Path('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node')
    playwright = pathlib.Path('/workspace/work/measure35-deps/node_modules/playwright/index.mjs')
    require(digest(node) == NODE_SHA, 'pinned Node executable differs')
    require(json.loads(playwright.with_name('package.json').read_text())['version'] == '1.58.2', 'Playwright version differs')
    require(digest('/usr/lib/chromium/chromium') == CHROMIUM_SHA, 'Chromium executable differs')
    require(set(os.sched_getaffinity(0)).issuperset({0, 1}), 'reviewed CPUs unavailable')
    output = pathlib.Path(args.output)
    require(output.is_absolute() and output == output.resolve(), 'canonical absolute output path required')
    runroot = output.parent
    require(not runroot.exists(), 'exclusive new R109 run root required')
    runroot.mkdir()
    env.update(R78_NATIVE='1', R78_PLAYWRIGHT=str(playwright), R78_CHROMIUM='/usr/bin/chromium',
               R78_SCRATCH=str(runroot / 'scratch-'), RS3_DATASET='duo-legacy', RS3_TASK_WORKER_MODE='process',
               NODE_DISABLE_COLORS='1')
    inner = ['timeout', '--signal=TERM', '--kill-after=2s', '180s', 'taskset', '-c', '0,1', str(node),
             '--max-old-space-size=768', '--test-reporter=spec', '--test-name-pattern=^' + NAME + '$',
             'tests/task-focus-native.test.mjs']
    command = [sys.executable, '-B', str(guard), str(output), '190', *inner]
    start = time.monotonic()
    (runroot / 'command.json').write_text(json.dumps({'command': command, 'cwd': str(root), 'sourcePin': PIN,
        'runtime': {'nodeSHA256': NODE_SHA, 'chromiumSHA256': CHROMIUM_SHA, 'playwrightVersion': '1.58.2'},
        'bounds': {'testSeconds': 150, 'innerSeconds': 180, 'guardSeconds': 190, 'outerSeconds': 215},
        'environment': 'RS3 and Node-test selectors scrubbed before Node; proxy/CA/runtime retained; hooks fail closed'}, indent=2) + '\n')
    # The caller supplies the reviewed 215s/+2 outer timeout. e97 owns its
    # barrier, process identities, 190s deadline, sampled RSS and cleanup.
    result = subprocess.run(command, cwd=root, env=env)
    events_path = output / 'events.ndjson'
    require(events_path.stat().st_size <= 8 * 1024**2, 'guard ledger cap')
    events = [json.loads(line) for line in events_path.read_text().splitlines()]
    terminal = events[-1]
    require(terminal['event'] == 'terminal', 'guard terminal missing')
    require(result.returncode == 0 and terminal['failure'] is None and terminal['rootCode'] == 0
            and terminal['observedBeforeCleanupCode'] == 0 and terminal['released'], 'guard/owned drain failed')
    control = next(row for row in events if row['event'] == 'control')
    require(control['cpus'] == [0, 1], 'guard CPU mask differs')
    postflight = []
    for pid, start_ticks in {**terminal['ownedGenerations'], str(control['identity']['pid']): control['identity']['start']}.items():
        current = generation(int(pid))
        absent = current is None or current['start'] != start_ticks or current['namespace'] != control['namespace']
        postflight.append({'pid': int(pid), 'start': start_ticks, 'ownedGenerationAbsent': absent})
        require(absent, 'recorded owned process generation remains present')
    log_path = output / 'product-output.log'
    require(log_path.stat().st_size <= 1024**2, 'native output cap')
    log = re.sub(r'\x1b\[[0-9;]*m', '', log_path.read_text())
    require(len(re.findall(r'^✔ ' + re.escape(NAME) + r' \(', log, re.M)) == 1, 'one exact named native PASS required')
    for label, count in [('tests', 1), ('pass', 1), ('fail', 0), ('cancelled', 0), ('skipped', 0)]:
        require(re.search(r'^ℹ ' + label + ' ' + str(count) + r'\s*$', log, re.M), f'actual test count differs: {label}')
    for tag in ['r109-native-witness ', 'r109-command-proof ', 'r109-fixture-drain ']:
        require(len(re.findall(r'^' + re.escape(tag), log, re.M)) == 1, f'exact functional evidence missing: {tag}')
    receipt = {'status': 'FIRST_ALPHA_PERSONAL_PASS', 'elapsedSeconds': time.monotonic() - start,
               'guardExit': result.returncode, 'terminal': terminal, 'postflight': postflight,
               'scope': 'instrumented controlled functional race; other six cases and all SLOs OPEN'}
    (runroot / 'first-case-result.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps({'status': receipt['status'], 'receipt': str(runroot / 'first-case-result.json')}))

if __name__ == '__main__': main()
