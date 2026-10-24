"""Pure controls: no Docker, processes, apps, network or fixture stress is run."""
import copy
import hashlib
import io
import json
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
import re
from unittest.mock import patch
import docker_envelope as e
import setup_diagnostics as diagnostics

CID = 'a' * 64
OWNER = 'b' * 32
SOURCES = {name: '/owned' + name for name in ('/source', '/harness', '/deps', '/runtime/node', '/runner', '/scratch')}

def workflow_path(base=None):
    base = Path(__file__).resolve().parent if base is None else base
    # Delivery bundle keeps the reviewed file adjacent; public checkout uses its canonical path.
    candidates = [base / 'public-container-envelope.yml', base.parents[2] / '.github/workflows/public-container-envelope.yml']
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise FileNotFoundError('public-control-workflow-not-found')

def admitted_doc():
    return {'Id': CID, 'Image': e.PINS['imageConfigDigest'],
        'Config': {'Image': e.PINS['image'], 'Labels': {e.LABEL: OWNER}, 'User': '1001:1001', 'Env': [f'{k}={v}' for k,v in e.expected_config_env().items()]},
        'HostConfig': {'NanoCpus': 2_000_000_000, 'CpusetCpus': '2,3', 'Memory': 6 * 1024**3,
          'MemorySwap': 6 * 1024**3, 'PidsLimit': 512, 'Init': True, 'NetworkMode': 'none',
          'ReadonlyRootfs': True, 'Privileged': False, 'CapAdd': [], 'CapDrop': ['ALL'],
          'SecurityOpt': ['no-new-privileges'], 'PidMode': '', 'IpcMode': 'private',
          'UTSMode': '', 'CgroupnsMode': 'private', 'PortBindings': {}, 'PublishAllPorts': False,
          'Devices': [], 'DeviceRequests': []},
        'Mounts': [{'Destination': k, 'Source': v, 'RW': k == '/scratch', 'Type': 'bind'} for k, v in SOURCES.items()],
        'State': {'Running': False, 'Pid': 0, 'Status': 'exited', 'ExitCode': 0, 'OOMKilled': False}}

class FakeDocker:
    def __init__(self, doc=None, stop_timeout=False):
        self.doc = doc or admitted_doc()
        self.stop_timeout = stop_timeout
        self.calls = []
        self.removed = False
    def inspect(self, cid):
        self.calls.append(['inspect', cid])
        return copy.deepcopy(self.doc)
    def call(self, argv, **kwargs):
        self.calls.append(argv)
        if argv[0] == 'stop' and self.stop_timeout:
            raise e.Blocked('docker-command-timeout')
        if argv[0] in {'stop', 'kill'}:
            self.doc['State'].update(Running=False, Pid=0, Status='exited')
        if argv[0] == 'rm':
            self.removed = True
        return SimpleNamespace(returncode=1 if argv[0] == 'inspect' and self.removed else 0, stdout=b'')

class Controls(unittest.TestCase):
    def test_allowed_cpu_list(self):
        self.assertEqual(e.parse_cpus('2-3,7'), {2, 3, 7})
    def test_bad_cpu_range(self):
        for s in ('3-2', '0,word', '-1', '1-9999999'):
            with self.subTest(s=s), self.assertRaises(e.Blocked): e.parse_cpus(s)
    def test_entrypoint_traversal(self):
        for s in ('../case.mjs', '/case.mjs', '.git/x.mjs', 'x;echo.mjs', 'a\\case.mjs'):
            with self.subTest(s=s), self.assertRaises(e.Blocked): e.safe_relative(s)
    def test_known_admission(self):
        self.assertEqual(e.hostconfig_errors(admitted_doc(), OWNER, [2, 3], e.profile('none'), 1001, SOURCES), [])
    def test_each_resource_rejected(self):
        for key, bad in [('NanoCpus', 250_000_000), ('CpusetCpus', '2'), ('Memory', 128 * 1024**2), ('MemorySwap', -1), ('PidsLimit', 0), ('Init', False)]:
            doc = admitted_doc(); doc['HostConfig'][key] = bad
            with self.subTest(key=key): self.assertTrue(e.hostconfig_errors(doc, OWNER, [2, 3], e.profile('none'), 1001, SOURCES))
    def test_bad_security_rejected(self):
        for key, bad in [('NetworkMode', 'host'), ('Privileged', True), ('CapAdd', ['SYS_ADMIN']), ('SecurityOpt', ['seccomp=unconfined']), ('ReadonlyRootfs', False), ('PidMode', 'host')]:
            doc = admitted_doc(); doc['HostConfig'][key] = bad
            with self.subTest(key=key): self.assertTrue(e.hostconfig_errors(doc, OWNER, [2, 3], e.profile('none'), 1001, SOURCES))
    def test_default_pid_uts_encoding_is_exact(self):
        for key in ('PidMode', 'UTSMode'):
            for bad in ('host', 'container:' + CID, 'private', None):
                doc = admitted_doc(); doc['HostConfig'][key] = bad
                with self.subTest(key=key, bad=bad):
                    self.assertIn('private-namespaces', e.hostconfig_errors(doc, OWNER, [2,3], e.profile('none'), 1001, SOURCES))
    def test_wrong_bind_source_rejected(self):
        doc = admitted_doc(); doc['Mounts'][0]['Source'] = '/host/credential-store'
        self.assertIn('exact-mounts', e.hostconfig_errors(doc, OWNER, [2, 3], e.profile('none'), 1001, SOURCES))
    def test_unexpected_environment_rejected(self):
        doc = admitted_doc(); doc['Config']['Env'].append('TOKEN=synthetic-secret')
        self.assertIn('explicit-environment', e.hostconfig_errors(doc, OWNER, [2, 3], e.profile('none'), 1001, SOURCES))
    def test_verified_public_image_env_union_is_exact(self):
        expected = e.expected_config_env()
        self.assertEqual(expected['LANG'],'C.UTF-8'); self.assertEqual(expected['LC_ALL'],'C.UTF-8')
        self.assertEqual(expected['PATH'],e.fixed_env()['PATH'])
        self.assertEqual(expected['PLAYWRIGHT_BROWSERS_PATH'],'/ms-playwright')
        self.assertEqual(e.hostconfig_errors(admitted_doc(),OWNER,[2,3],e.profile('none'),1001,SOURCES),[])
    def test_corrupted_public_image_env_value_rejected(self):
        for key in ('LANG','LC_ALL'):
            doc=admitted_doc();doc['Config']['Env']=[key+'=corrupted' if value.startswith(key+'=') else value for value in doc['Config']['Env']]
            with self.subTest(key=key):self.assertIn('explicit-environment',e.hostconfig_errors(doc,OWNER,[2,3],e.profile('none'),1001,SOURCES))
    def test_image_content_mismatch_rejected(self):
        doc = admitted_doc(); doc['Image'] = 'sha256:' + 'c' * 64
        self.assertIn('image-content', e.hostconfig_errors(doc, OWNER, [2, 3], e.profile('none'), 1001, SOURCES))
    def test_extra_bind_rejected(self):
        doc = admitted_doc(); doc['Mounts'].append({'Destination': '/host', 'Source': '/', 'RW': True, 'Type': 'bind'})
        self.assertIn('exact-mounts', e.hostconfig_errors(doc, OWNER, [2, 3], e.profile('none'), 1001, SOURCES))
    def test_writable_source_rejected(self):
        doc = admitted_doc(); doc['Mounts'][0]['RW'] = True
        self.assertIn('exact-mounts', e.hostconfig_errors(doc, OWNER, [2, 3], e.profile('none'), 1001, SOURCES))
    def test_missing_init_negative_is_only_init(self):
        doc = admitted_doc(); doc['HostConfig']['Init'] = False
        self.assertEqual(e.hostconfig_errors(doc, OWNER, [2, 3], e.profile('missing-init'), 1001, SOURCES), ['init'])
    def test_cleanup_refuses_wrong_owner(self):
        fake = FakeDocker()
        with self.assertRaises(e.Blocked): e.owned_cleanup(fake, CID, 'wrong', lambda *_: None)
        self.assertFalse(any(x[0] in {'stop', 'kill', 'rm'} for x in fake.calls))
    def test_cleanup_refuses_partial_id(self):
        fake = FakeDocker()
        with self.assertRaises(e.Blocked): e.owned_cleanup(fake, CID[:12], OWNER, lambda *_: None)
        self.assertEqual(fake.calls, [])
    def test_exact_cleanup_for_exited_container(self):
        fake = FakeDocker(); e.owned_cleanup(fake, CID, OWNER, lambda *_: None)
        self.assertTrue(fake.removed)
        for call in fake.calls: self.assertEqual(call[-1], CID)
    def test_stop_timeout_forces_exact_owned_kill(self):
        doc = admitted_doc(); doc['State'].update(Running=True, Pid=4321, Status='running')
        fake = FakeDocker(doc, stop_timeout=True)
        e.owned_cleanup(fake, CID, OWNER, lambda *_: None)
        self.assertIn(['kill', CID], fake.calls)
        self.assertTrue(fake.removed)
    def test_never_started_negative_skips_wait(self):
        doc = admitted_doc(); doc['State']['Status'] = 'created'
        fake = FakeDocker(doc); e.owned_cleanup(fake, CID, OWNER, lambda *_: None)
        self.assertFalse(any(x[0] == 'wait' for x in fake.calls))
    def test_stop_kill_race_uses_fresh_exited_state(self):
        class RaceDocker(FakeDocker):
            def call(self, argv, **kwargs):
                result = super().call(argv, **kwargs)
                if argv[0] == 'kill': result.returncode = 1
                return result
        doc = admitted_doc(); doc['State'].update(Running=True, Pid=123, Status='running')
        fake = RaceDocker(doc, stop_timeout=True)
        e.owned_cleanup(fake, CID, OWNER, lambda *_: None)
        self.assertTrue(fake.removed)
    def test_cleanup_removes_before_log_failure(self):
        fake = FakeDocker()
        def failed_log(*_args): raise OSError('synthetic full log device')
        with self.assertRaises(OSError): e.owned_cleanup(fake, CID, OWNER, failed_log)
        self.assertTrue(fake.removed)
    def test_public_projection_discards_auth_url_and_store(self):
        got = e.sanitized_result({'schema':'r116-frozen-browser-v1', 'status':'blocked', 'sourcePin':'a'*40,
          'fixtureSha256':'b'*64, 'finalProofSha256':'d'*64, 'token':'SYNTHETIC_SECRET', 'url':'http://localhost/?token=SYNTHETIC_SECRET',
          'store': {'private':'SYNTHETIC_SECRET'}, 'metrics': {'allDomMs': 12.5, 'token': 22},
          'scope': {'memberId':'explorer-1', 'chunkId':'12850', 'group':False, 'token':'SYNTHETIC_SECRET'}})
        text = json.dumps(got)
        self.assertNotIn('SYNTHETIC_SECRET', text); self.assertNotIn('localhost', text)
        self.assertEqual(got['sourcePin'], 'a'*40); self.assertEqual(got['metrics']['allDomMs'], 12.5)
        self.assertEqual(got['finalProofSha256'], 'd'*64)
    def test_public_projection_rejects_arbitrary_status_and_nonhex(self):
        got = e.sanitized_result({'status': {'private':'SYNTHETIC_SECRET'}, 'sourcePin':'not-a-hash', 'nodeVersion':'v999', 'scope': {'group':0}})
        self.assertNotIn('status', got); self.assertNotIn('sourcePin', got); self.assertEqual(got['scope'], {})
    def test_outer_projection_rejects_raw_metric_payload(self):
        doc = {'schema':'docker-hard-2cpu-6g-result-v1', 'passed':True, 'control':'none', 'samples':'http://localhost/?token=secret'}
        with self.assertRaises(e.Blocked): e.envelope_projection(doc, 'none')
    def test_raw_failed_report_is_never_valid(self):
        with self.assertRaises(e.Blocked): e.envelope_projection({'schema':'wrong', 'token':'secret'}, 'none')
    def test_bounded_reader_rejects_nonregular_before_read(self):
        flags = []
        def opened(_path, value): flags.append(value); return 90
        with patch.object(e.os, 'open', side_effect=opened), patch.object(e.os, 'fstat', return_value=SimpleNamespace(st_mode=0o010000, st_size=0)), patch.object(e.os, 'read', side_effect=AssertionError('read FIFO')), patch.object(e.os, 'close'):
            with self.assertRaises(e.Blocked): e.bounded_bytes('/owned/fifo')
        self.assertEqual(flags[0] & getattr(os, 'O_NONBLOCK', 0), getattr(os, 'O_NONBLOCK', 0))
        self.assertEqual(flags[0] & getattr(os, 'O_NOFOLLOW', 0), getattr(os, 'O_NOFOLLOW', 0))
    def test_cidfile_recovers_malformed_create_stdout(self):
        with patch.object(Path, 'exists', return_value=True), patch.object(e, 'bounded_bytes', return_value=(CID+'\n').encode()):
            self.assertEqual(e.recover_cid('malformed-output', Path('/owned/container.cid')), CID)
    def test_valid_cid_never_reads_cidfile(self):
        with patch.object(e, 'bounded_bytes', side_effect=AssertionError('unexpected recovery read')):
            self.assertEqual(e.recover_cid(CID, Path('/owned/container.cid')), CID)
    def test_plan_never_opens_inputs_or_docker(self):
        a = e.parser().parse_args(['--source','missing-source','--harness','missing-harness','--deps','missing-deps','--node','missing-node','--output','missing-output','--harness-commit','a'*40])
        with patch.object(e, 'Docker', side_effect=AssertionError('Docker touched')), patch.object(e, 'verify_receipt', side_effect=AssertionError('inputs touched')):
            self.assertTrue(e.run(a)['preparedOnly'])
    def test_duration_and_soak_boundaries(self):
        base = ['--source','s','--harness','h','--deps','d','--node','n','--output','o','--harness-commit','a'*40]
        for extra in (['--seconds','0'], ['--seconds','2001'], ['--mode','soak','--seconds','1799']):
            with self.subTest(extra=extra), self.assertRaises(e.Blocked): e.validate_args(e.parser().parse_args(base + extra))
    def test_control_caps_are_distinct_versioned_experiments(self):
        self.assertEqual(e.profile('cpu')['cpus'], .25)
        self.assertEqual(e.profile('memory')['memory'], 128 * 1024**2)
        self.assertEqual(e.profile('none')['memory'], 6 * 1024**3)
    def test_child_oom_docker_flag_does_not_replace_memory_control_proof(self):
        self.assertTrue(e.container_exit_allowed({'ExitCode':0,'OOMKilled':False}, 'memory'))
        self.assertTrue(e.container_exit_allowed({'ExitCode':0,'OOMKilled':True}, 'memory'))
        self.assertFalse(e.container_exit_allowed({'ExitCode':137,'OOMKilled':True}, 'memory'))
        self.assertFalse(e.container_exit_allowed({'ExitCode':0,'OOMKilled':True}, 'none'))
    def test_created_command_has_independent_watchdog_and_explicit_env(self):
        a = e.parser().parse_args(['--source','s','--harness','h','--deps','d','--node','n','--output','o','--harness-commit','a'*40,'--seconds','2000'])
        command = e.create_args(a, OWNER, [2, 3], 1001, 1001)
        self.assertEqual(command[command.index('--entrypoint')+1], '/usr/bin/timeout')
        self.assertIn('1980s', command); self.assertIn('--kill-after=3s', command)
        self.assertIn('--cidfile', command); self.assertIn('--init', command)
        self.assertNotIn('--pid', command); self.assertNotIn('--uts', command)
        self.assertEqual(command[command.index('--ipc')+1], 'private')
        self.assertEqual(command[command.index('--cgroupns')+1], 'private')
        self.assertNotIn('--env-file', command); self.assertNotIn('--privileged', command)
        forwarded = [command[i+1] for i, value in enumerate(command) if value == '--env']
        self.assertEqual(set(forwarded), {f'{k}={v}' for k,v in e.fixed_env().items()})
    def test_missing_init_command_omits_init_and_changes_no_other_cap(self):
        a = e.parser().parse_args(['--source','s','--harness','h','--deps','d','--node','n','--output','o','--harness-commit','a'*40,'--control','missing-init'])
        command = e.create_args(a, OWNER, [2, 3], 1001, 1001)
        self.assertNotIn('--init', command)
        self.assertEqual(command[command.index('--memory')+1], str(6 * 1024**3))
    def test_both_workflow_recipes_use_distinct_empty_npm_configs(self):
        workflow = workflow_path().read_text()
        pairs = re.findall(r'npm_config_userconfig="([^"]+)"\s+npm_config_globalconfig="([^"]+)"', workflow)
        self.assertEqual(len(pairs), 6)
        for user, global_config in pairs:
            self.assertNotEqual(user, global_config)
            self.assertNotEqual(user, '/dev/null'); self.assertNotEqual(global_config, '/dev/null')
            self.assertIn(': > "' + user + '"', workflow)
            self.assertIn(': > "' + global_config + '"', workflow)
    def test_both_setup_failures_use_closed_diagnostics(self):
        workflow = workflow_path().read_text()
        self.assertEqual(workflow.count('--stage dependency-setup'), 6)
        self.assertEqual(workflow.count('--stage public-image-pull'), 6)
        self.assertNotIn('cat "$RUNNER_TEMP/npm-setup.log"', workflow)
        self.assertNotIn('tail "$RUNNER_TEMP/image-pull.log"', workflow)
    def test_workflow_path_supports_canonical_public_layout(self):
        base = Path('/public/docs/research/codex-cloud-runner')
        with patch.object(Path, 'is_file', side_effect=[False, True]):
            self.assertEqual(workflow_path(base), base.parents[2] / '.github/workflows/public-container-envelope.yml')
    def test_workflow_path_missing_both_locations_fails_closed(self):
        with patch.object(Path, 'is_file', return_value=False):
            with self.assertRaises(FileNotFoundError): workflow_path(Path('/public/docs/research/codex-cloud-runner'))
    def test_setup_diagnostic_never_echoes_original_tail(self):
        raw = b'npm error double-loading config /private/SYNTHETIC_SECRET\nAuthorization: Bearer SYNTHETIC_TOKEN\nhttps://registry.example/?token=SYNTHETIC_TOKEN\n{"store":"SYNTHETIC_STATE"}'
        primary, tail = diagnostics.summarize_tail(raw, 'dependency-setup')
        result = json.dumps({'errorClass':primary, 'normalizedTail':tail})
        self.assertEqual(primary, 'npm-config-source-duplicate')
        for secret in ('SYNTHETIC', '/private/', 'https:', 'Authorization', 'store'):
            self.assertNotIn(secret, result)
    def test_setup_diagnostic_docker_classes_are_fixed(self):
        self.assertEqual(diagnostics.line_class('unauthorized https://private/?token=secret', 'public-image-pull'), 'image-auth-denied')
        self.assertEqual(diagnostics.line_class('no matching manifest for linux/amd64 with private label', 'public-image-pull'), 'platform-unavailable')
        self.assertEqual(diagnostics.line_class('Cannot connect to the Docker daemon at a private path', 'public-image-pull'), 'docker-daemon-unavailable')
        self.assertEqual(diagnostics.line_class('FileNotFoundError: /private/SYNTHETIC_SECRET', 'pure-controls'), 'pure-controls-input-missing')
        raw = b'ERROR: test_both_workflow_recipes_use_distinct_empty_npm_configs (Controls)\nERROR: test_SYNTHETIC_SECRET (private.unknown)\n'
        self.assertEqual(diagnostics.pure_test_ids(raw), ['test_both_workflow_recipes_use_distinct_empty_npm_configs'])
    def test_setup_diagnostic_only_uses_bounded_tail(self):
        raw = b'double-loading config\n' + b'x' * (diagnostics.TAIL_BYTES + 1)
        primary, tail = diagnostics.summarize_tail(raw, 'dependency-setup')
        self.assertEqual(primary, 'unknown-setup-error')
        self.assertEqual(tail, ['unclassified-output-omitted'])
        self.assertLessEqual(len(tail), 8)
    def test_setup_diagnostic_hashes_complete_small_log(self):
        raw = b'npm error double-loading config SYNTHETIC_SECRET\n'
        with patch.object(diagnostics.os, 'open', return_value=90) as opened, patch.object(diagnostics.os, 'fstat', return_value=SimpleNamespace(st_mode=0o100600, st_size=len(raw))), patch.object(diagnostics.os, 'read', side_effect=[raw,b'']), patch.object(diagnostics.os, 'close'):
            result = diagnostics.diagnose('dependency-setup', 1, '/owned/log')
        self.assertEqual(opened.call_args.args[1] & getattr(os, 'O_BINARY', 0), getattr(os, 'O_BINARY', 0))
        self.assertEqual(result['logSha256'], hashlib.sha256(raw).hexdigest())
        self.assertEqual(result['logBytes'], len(raw))
        self.assertNotIn('SYNTHETIC_SECRET', json.dumps(result))
    def test_setup_diagnostic_rejects_fifo_before_read(self):
        with patch.object(diagnostics.os, 'open', return_value=90), patch.object(diagnostics.os, 'fstat', return_value=SimpleNamespace(st_mode=0o010000, st_size=0)), patch.object(diagnostics.os, 'read', side_effect=AssertionError('read FIFO')), patch.object(diagnostics.os, 'close'):
            with self.assertRaises(ValueError): diagnostics.diagnose('dependency-setup',1,'/owned/fifo')
    def test_setup_diagnostic_cli_errors_do_not_echo_paths_or_arguments(self):
        output = io.StringIO()
        with patch('sys.stdout', output):
            self.assertEqual(diagnostics.main(['--stage','SYNTHETIC_SECRET','--log','/private/SYNTHETIC_SECRET','--exit-code','1']),0)
        self.assertNotIn('SYNTHETIC_SECRET', output.getvalue())
        self.assertEqual(json.loads(output.getvalue())['errorClass'],'diagnostic-unavailable')
    def test_docker_diagnostic_never_emits_actual_argv_or_output(self):
        raw = b'invalid PID mode: SYNTHETIC_SECRET at /private/path?token=SYNTHETIC_TOKEN'
        result = e.docker_diagnostic(['create','--mount','/private/SYNTHETIC_SECRET'],125,b'SYNTHETIC_STATE',raw)
        self.assertEqual(result['commandStage'],'docker-create')
        self.assertEqual(result['errorClass'],'invalid-pid-mode')
        self.assertEqual(result['stderrSha256'],hashlib.sha256(raw).hexdigest())
        self.assertEqual(result['stderrBytes'],len(raw))
        self.assertNotIn('SYNTHETIC',json.dumps(result)); self.assertNotIn('/private/',json.dumps(result))
    def test_unknown_docker_verb_is_fixed(self):
        result = e.docker_diagnostic(['SYNTHETIC_SECRET'],1,b'',b'private unknown output')
        self.assertEqual(result['commandStage'],'docker-unknown')
        self.assertEqual(result['argvTemplate'],'docker <unclassified-command>')
        self.assertNotIn('SYNTHETIC',json.dumps(result))
    def test_docker_call_failure_is_classified_without_running_docker(self):
        obj = object.__new__(e.Docker); obj.base=['docker']; obj.env={}; obj.emit=None; obj.diagnostics=[]
        response = SimpleNamespace(returncode=125,stdout=b'',stderr=b'invalid UTS mode: private')
        with patch.object(e.subprocess,'run',return_value=response):
            with self.assertRaises(e.Blocked): obj.call(['create','--uts','private'])
        self.assertEqual(obj.diagnostics[0]['commandStage'],'docker-create')
        self.assertEqual(obj.diagnostics[0]['errorClass'],'invalid-uts-mode')
        self.assertEqual(obj.diagnostics[0]['exitCode'],125)
    def test_docker_call_timeout_preserves_partial_output_hashes(self):
        obj = object.__new__(e.Docker); obj.base=['docker']; obj.env={}; obj.emit=None; obj.diagnostics=[]
        timeout = e.subprocess.TimeoutExpired(['docker'],1,output=b'partial',stderr=b'SYNTHETIC_SECRET')
        with patch.object(e.subprocess,'run',side_effect=timeout):
            with self.assertRaises(e.Blocked): obj.call(['inspect',CID])
        result=obj.diagnostics[0]
        self.assertEqual(result['errorClass'],'docker-command-timeout'); self.assertFalse(result['outputComplete'])
        self.assertEqual(result['stderrSha256'],hashlib.sha256(b'SYNTHETIC_SECRET').hexdigest())
        self.assertNotIn('SYNTHETIC',json.dumps(result))
    def test_docker_failure_logging_cannot_abort_cleanup(self):
        obj = object.__new__(e.Docker); obj.diagnostics=[]
        def failed_emit(*_args): raise OSError('synthetic log device failure')
        obj.emit=failed_emit
        obj.record_failure(['stop',CID],1,b'',b'unknown')
        self.assertEqual(obj.diagnostics[0]['commandStage'],'docker-stop')
    def test_r127_all_fixed_metrics_and_hashes_survive_projection(self):
        keys=[f'r127{mode}{thermal}Rep{rep}Ms' for mode in ('OriginalSync','PrototypeSync','OldCooperative','NewBudgeted') for thermal in ('Cold','Warm') for rep in range(3)]+['r127SetupMs']
        metrics={key:i+.5 for i,key in enumerate(keys)}
        value={'schema':'container-component-control-v1','mode':'r127-four-mode-docker-v1','passed':True,'componentStateSha256':'a'*64,'componentRowsSha256':'b'*64,'componentIndexSha256':'c'*64,'metrics':metrics}
        got=e.sanitized_result(value)
        self.assertEqual(got['mode'],value['mode']);self.assertEqual(got['schema'],value['schema'])
        self.assertEqual(got['metrics'],metrics);self.assertEqual(len(got['metrics']),25)
        for key in ('componentStateSha256','componentRowsSha256','componentIndexSha256'):self.assertEqual(got[key],value[key])
    def test_r127_unexpected_fields_secret_values_and_nonfinite_metrics_rejected(self):
        got=e.sanitized_result({'mode':'r127-four-mode-docker-v1','private':'SYNTHETIC_SECRET','componentStateSha256':'SYNTHETIC_SECRET','metrics':{'r127SetupMs':float('nan'),'r127OriginalSyncColdRep0Ms':float('inf'),'unexpected':123,'r127NewBudgetedWarmRep2Ms':'SYNTHETIC_SECRET'}})
        self.assertEqual(got['metrics'],{});self.assertNotIn('componentStateSha256',got)
        self.assertNotIn('SYNTHETIC',json.dumps(got));self.assertNotIn('unexpected',json.dumps(got))
    def test_r124_projection_retains_fixed_vector_proof_and_rejects_private_or_malformed_values(self):
        hashes={key:'a'*64 for key in ('r124BaselineProviderDigest','r124CandidateProviderDigest','r124BaselineVectorsSha256','r124CandidateVectorsSha256','r124ComparisonSha256','r124PacketManifestSha256')}
        value={'schema':'r124-engine-api-comparison-v1','mode':'r124-engine-api-v1','code':'r124-full-engine-vectors-match','passed':True,**hashes,'metrics':{'r124BaselineCompletedCases':8,'r124CandidateCompletedCases':8}}
        got=e.sanitized_result(value)
        self.assertEqual(got['schema'],value['schema']);self.assertEqual(got['mode'],value['mode']);self.assertEqual(got['code'],value['code'])
        for key,digest in hashes.items():self.assertEqual(got[key],digest)
        self.assertEqual(got['metrics'],value['metrics'])
        bad=e.sanitized_result({'passed':False,'r124ComparisonSha256':'token=SYNTHETIC_SECRET','vectors':{'private':'SYNTHETIC_SECRET'},'metrics':{'r124BaselineCompletedCases':float('nan'),'r124CandidateCompletedCases':'SYNTHETIC_SECRET'}})
        self.assertFalse(bad['passed']);self.assertEqual(bad['metrics'],{});self.assertNotIn('SYNTHETIC',json.dumps(bad))
    def test_r125_projection_preserves_all_named_flags_and_failed_case_scope(self):
        flags=('nativeAssertionsPassed','freshBodyJoinPassed','cachedFallbackPassed','realSlicePassed','trustedSpacePassed','commandHistoryPassed','persistedOwnerReadbackPassed','fixtureDrainPassed','controllerDrainPassed','originalSourceUnchanged')
        value={'schema':'r125-focus-functional-v1','mode':'r125-alpha-personal-controlled-v1','code':'r125-focus-correct','passed':True,'cleanupPassed':True,**{key:True for key in flags},'scope':{'owner':'alpha','group':False},'finalProofSha256':'b'*64,'observedBodySha256':'c'*64,'metrics':{'focusNamedPassCount':1,'focusCommandCount':2,'focusHistoryCount':2},'openGates':['r125-other-native-cases','r125-slo']}
        got=e.sanitized_result(value)
        for key in flags:self.assertIs(got[key],True)
        for key in ('schema','mode','code','scope','metrics','openGates','finalProofSha256','observedBodySha256'):self.assertEqual(got[key],value[key])
        bad=e.sanitized_result({'passed':False,'code':'r125-native-failed','nativeAssertionsPassed':'SYNTHETIC_SECRET','scope':{'owner':'private-owner','group':False},'metrics':{'focusCommandCount':'SYNTHETIC_SECRET'},'store':'SYNTHETIC_SECRET'})
        self.assertFalse(bad['passed']);self.assertEqual(bad['code'],'r125-native-failed');self.assertNotIn('owner',bad['scope']);self.assertNotIn('nativeAssertionsPassed',bad);self.assertNotIn('SYNTHETIC',json.dumps(bad))
    def test_r130_projection_preserves_both_backend_outcomes_and_rejects_unknown_status(self):
        value={'schema':'r130-codec-functional-v1','passed':True,'processStatus':'correct','threadStatus':'correct','metrics':{'processElapsedMs':12.5,'threadElapsedMs':8.5,'processGenerations':4,'threadGenerations':4}}
        got=e.sanitized_result(value)
        for key in ('schema','passed','processStatus','threadStatus','metrics'):self.assertEqual(got[key],value[key])
        bad=e.sanitized_result({'passed':False,'processStatus':'correct?token=SYNTHETIC_SECRET','threadStatus':'failed','metrics':{'processGenerations':float('inf'),'threadElapsedMs':float('nan')},'ipc':'SYNTHETIC_SECRET'})
        self.assertFalse(bad['passed']);self.assertEqual(bad['threadStatus'],'failed');self.assertNotIn('processStatus',bad);self.assertEqual(bad['metrics'],{});self.assertNotIn('SYNTHETIC',json.dumps(bad))

if __name__ == '__main__': unittest.main()
