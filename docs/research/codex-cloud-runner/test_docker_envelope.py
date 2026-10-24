"""Pure controls: no Docker, processes, apps, network or fixture stress is run."""
import copy
import json
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import docker_envelope as e

CID = 'a' * 64
OWNER = 'b' * 32
SOURCES = {name: '/owned' + name for name in ('/source', '/harness', '/deps', '/runtime/node', '/runner', '/scratch')}

def admitted_doc():
    return {'Id': CID, 'Image': e.PINS['imageConfigDigest'],
        'Config': {'Image': e.PINS['image'], 'Labels': {e.LABEL: OWNER}, 'User': '1001:1001', 'Env': [f'{k}={v}' for k,v in e.fixed_env().items()]},
        'HostConfig': {'NanoCpus': 2_000_000_000, 'CpusetCpus': '2,3', 'Memory': 6 * 1024**3,
          'MemorySwap': 6 * 1024**3, 'PidsLimit': 512, 'Init': True, 'NetworkMode': 'none',
          'ReadonlyRootfs': True, 'Privileged': False, 'CapAdd': [], 'CapDrop': ['ALL'],
          'SecurityOpt': ['no-new-privileges'], 'PidMode': 'private', 'IpcMode': 'private',
          'UTSMode': 'private', 'CgroupnsMode': 'private', 'PortBindings': {}, 'PublishAllPorts': False,
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
    def test_wrong_bind_source_rejected(self):
        doc = admitted_doc(); doc['Mounts'][0]['Source'] = '/host/credential-store'
        self.assertIn('exact-mounts', e.hostconfig_errors(doc, OWNER, [2, 3], e.profile('none'), 1001, SOURCES))
    def test_unexpected_environment_rejected(self):
        doc = admitted_doc(); doc['Config']['Env'].append('TOKEN=synthetic-secret')
        self.assertIn('explicit-environment', e.hostconfig_errors(doc, OWNER, [2, 3], e.profile('none'), 1001, SOURCES))
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
          'fixtureSha256':'b'*64, 'token':'SYNTHETIC_SECRET', 'url':'http://localhost/?token=SYNTHETIC_SECRET',
          'store': {'private':'SYNTHETIC_SECRET'}, 'metrics': {'allDomMs': 12.5, 'token': 22},
          'scope': {'memberId':'explorer-1', 'chunkId':'12850', 'group':False, 'token':'SYNTHETIC_SECRET'}})
        text = json.dumps(got)
        self.assertNotIn('SYNTHETIC_SECRET', text); self.assertNotIn('localhost', text)
        self.assertEqual(got['sourcePin'], 'a'*40); self.assertEqual(got['metrics']['allDomMs'], 12.5)
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
        self.assertNotIn('--env-file', command); self.assertNotIn('--privileged', command)
        forwarded = [command[i+1] for i, value in enumerate(command) if value == '--env']
        self.assertEqual(set(forwarded), {f'{k}={v}' for k,v in e.fixed_env().items()})
    def test_missing_init_command_omits_init_and_changes_no_other_cap(self):
        a = e.parser().parse_args(['--source','s','--harness','h','--deps','d','--node','n','--output','o','--harness-commit','a'*40,'--control','missing-init'])
        command = e.create_args(a, OWNER, [2, 3], 1001, 1001)
        self.assertNotIn('--init', command)
        self.assertEqual(command[command.index('--memory')+1], str(6 * 1024**3))

if __name__ == '__main__': unittest.main()
