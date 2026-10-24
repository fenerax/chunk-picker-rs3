"""Raw CLI/public-layout closure controls; reads source bytes, never imports case code."""
import contextlib
import copy
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from verify_case_closure import definition,verify,main
from test_docker_envelope import workflow_path

HERE=Path(__file__).resolve().parent
PUBLIC_ROOT=HERE.parents[2]
WORKFLOW_PATH=workflow_path(HERE)
RAW=WORKFLOW_PATH.read_bytes()
WORKFLOW=RAW.decode('utf8')
CLOSURE=json.loads((HERE/'case-runtime-closure.json').read_text())
EXPECTED={'r116-close-diagnostic':13,'r139-body-lifecycle':9}

class CaseClosureControls(unittest.TestCase):
    def cli(self,workflow,mapping,harness):
        stream=io.StringIO()
        with contextlib.redirect_stdout(stream):status=main(['--workflow',str(workflow),'--map',str(mapping),'--harness',str(harness)])
        return status,json.loads(stream.getvalue())

    def test_both_observation_actual_full_runtime_maps_and_member_bytes(self):
        self.assertEqual({k:len(v['assets']) for k,v in CLOSURE['cases'].items()},EXPECTED)
        self.assertEqual(verify(WORKFLOW,CLOSURE,lambda name:(PUBLIC_ROOT/name).read_bytes()),2)

    def test_main_raw_lf_and_crlf_both_observation_exact_public_asset_closures(self):
        with tempfile.TemporaryDirectory(dir=HERE,prefix='pure-closure-') as name:
            root=Path(name).resolve();self.assertIn(HERE,root.parents)
            lf=RAW.replace(b'\r\n',b'\n')
            for label,raw in [('lf',lf),('crlf',lf.replace(b'\n',b'\r\n'))]:
                workflow=root/(label+'.yml');workflow.write_bytes(raw)
                status,result=self.cli(workflow,HERE/'case-runtime-closure.json',PUBLIC_ROOT)
                self.assertEqual(status,0);self.assertTrue(result['passed']);self.assertEqual(result['enabledCases'],2)
                self.assertIsNone(result['failurePhase'])

    def test_main_actual_frozen_592crlf_workflow_with_real15_r131_assets(self):
        fixture=HERE/'r131-crlf-workflow.fixture.yml';raw=fixture.read_bytes()
        self.assertEqual(raw.count(b'\r\n'),592);self.assertEqual(raw.count(b'\n'),592)
        self.assertEqual(hashlib.sha256(raw).hexdigest(),'3d1706814dcd5af3d99f3a1105a8d5b6589b2d3311961db1219398d18fc78b6c')
        with tempfile.TemporaryDirectory(dir=HERE,prefix='pure-closure-') as name:
            root=Path(name).resolve();self.assertIn(HERE,root.parents);mapping=root/'r131-only.json'
            mapping.write_bytes((HERE/'r131-crlf-runtime.fixture.json').read_bytes())
            status,result=self.cli(fixture,mapping,PUBLIC_ROOT)
            self.assertEqual(status,0);self.assertTrue(result['passed']);self.assertEqual(result['enabledCases'],1)

    def test_observed_wrong_prefix_and_same_basename_are_rejected(self):
        wrong=WORKFLOW.replace('--entrypoint docs/research/codex-cloud-assets/r139/entry.mjs','--entrypoint docs/research/codex-cloud-assets/r139-other/entry.mjs')
        with self.assertRaises(ValueError):definition(wrong,CLOSURE)
        for change in (WORKFLOW.replace('    if: ${{ success() }}',''),WORKFLOW.replace('    needs: controls','')):
            with self.assertRaises(ValueError):definition(change,CLOSURE)

    def test_each_full_map_rejects_missing_entry_manifest_and_duplicate_asset(self):
        for job in EXPECTED:
            for kind in ('entry','manifest','duplicate'):
                value=copy.deepcopy(CLOSURE);case=value['cases'][job]
                if kind=='duplicate':case['assets'].append(case['assets'][0])
                else:case['assets']=[r for r in case['assets'] if r['path']!=case['entrypoint' if kind=='entry' else 'manifest']]
                with self.assertRaises(ValueError):definition(WORKFLOW,value)

    def test_changed_byte_and_rehashed_manifest_missing_member_fail_closed(self):
        data={row['path']:(PUBLIC_ROOT/row['path']).read_bytes() for case in CLOSURE['cases'].values() for row in case['assets']}
        for job in EXPECTED:
            case=CLOSURE['cases'][job];changed=dict(data);changed[case['entrypoint']]=b'changed-public-bytes'
            with self.assertRaises(ValueError):verify(WORKFLOW,CLOSURE,changed.__getitem__)
            value=copy.deepcopy(CLOSURE);selected=value['cases'][job];manifest=json.loads(data[selected['manifest']])
            if selected['manifestKind']=='r125':manifest['runtimeFiles'].pop(next(iter(manifest['runtimeFiles'])))
            else:manifest['files'].pop(0)
            raw=json.dumps(manifest).encode();digest=hashlib.sha256(raw).hexdigest();selected['manifestSha256']=digest
            for row in selected['assets']:
                if row['path']==selected['manifest']:row.update(bytes=len(raw),sha256=digest)
            changed=dict(data);changed[selected['manifest']]=raw
            with self.assertRaises(ValueError):verify(WORKFLOW,value,changed.__getitem__)

    def test_main_failure_phase_job_and_ordinal_never_echo_paths(self):
        with tempfile.TemporaryDirectory(dir=HERE,prefix='pure-closure-') as name:
            root=Path(name).resolve();self.assertIn(HERE,root.parents)
            status,result=self.cli(WORKFLOW_PATH,HERE/'case-runtime-closure.json',root)
            self.assertEqual(status,1);self.assertEqual(result['failurePhase'],'member-read')
            self.assertEqual(result['job'],'r116-close-diagnostic');self.assertEqual(result['memberOrdinal'],0)
            self.assertNotIn(str(root),json.dumps(result));self.assertEqual(result['reasonCode'],'case-runtime-closure-failed')

if __name__=='__main__':unittest.main()
