"""Pure actual-publication closure checks, with no app or container imports."""
import copy
import hashlib
import json
from pathlib import Path
import unittest
from verify_case_closure import definition,verify

HERE=Path(__file__).resolve().parent
WORKFLOW=(HERE/'public-container-envelope.yml').read_text()
CLOSURE=json.loads((HERE/'case-runtime-closure.json').read_text())

class CaseClosureControls(unittest.TestCase):
    def test_actual_published_entry_and_complete_manifest_closure(self):
        self.assertEqual(definition(WORKFLOW,CLOSURE),{'r131-native':'docs/research/codex-cloud-assets/r131/entry.mjs'})
        self.assertEqual(CLOSURE['actualAssetMapSha256'],'7d11791275549e35b2a86811aece1993e69528b7e288ce883861416a0a9bec5d')
        self.assertEqual(len(CLOSURE['cases']['r131-native']['assets']),15)

    def test_original_observed_wrong_prefix_and_same_basename_are_rejected(self):
        wrong=WORKFLOW.replace('--entrypoint docs/research/codex-cloud-assets/r131/entry.mjs','--entrypoint docs/research/codex-cloud-assets/r131-diagnostic-v2/entry.mjs')
        with self.assertRaises(ValueError):definition(wrong,CLOSURE)
        case=copy.deepcopy(CLOSURE);case['cases']['r131-native']['entrypoint']='docs/research/codex-cloud-assets/other/entry.mjs'
        with self.assertRaises(ValueError):definition(WORKFLOW,case)
        for change in (WORKFLOW.replace('    if: ${{ success() }}\n',''),WORKFLOW.replace('    needs: controls\n','')):
            with self.assertRaises(ValueError):definition(change,CLOSURE)

    def test_missing_entry_manifest_and_duplicate_assets_are_rejected(self):
        for kind in ('entry','manifest','duplicate'):
            value=copy.deepcopy(CLOSURE);case=value['cases']['r131-native']
            if kind=='duplicate':case['assets'].append(case['assets'][0])
            else:case['assets']=[row for row in case['assets'] if row['path']!=case['entrypoint' if kind=='entry' else 'manifest']]
            with self.assertRaises(ValueError):definition(WORKFLOW,value)

    def test_changed_byte_hash_and_missing_runtime_member_fail_closed(self):
        # Actual public map values are authenticated above; these tiny fake byte readers
        # prove changed/missing bytes cannot satisfy the runtime preflight.
        with self.assertRaises(ValueError):verify(WORKFLOW,CLOSURE,lambda name:b'changed-public-bytes')
        with self.assertRaises(FileNotFoundError):verify(WORKFLOW,CLOSURE,lambda name:(_ for _ in ()).throw(FileNotFoundError()))

    def test_manifest_entry_disagreement_fails_even_with_rehashed_manifest(self):
        # Full byte-positive fixture is tiny and independent of the application.
        prefix='docs/research/codex-cloud-assets/r131/';entry=b'// public fixture\n'
        manifest={'schema':'r131-required-runtime-assets-v1','sourceCommit':'6f22fefa782747790e2eaefa01e4e5ea7b557323','entry':'entry.mjs','files':[{'path':'entry.mjs','bytes':len(entry),'sha256':hashlib.sha256(entry).hexdigest()}]}
        def fixture(m):
            raw=json.dumps(m).encode();data={prefix+'entry.mjs':entry,prefix+'runtime-publication-manifest.json':raw}
            assets=[{'path':name,'bytes':len(value),'sha256':hashlib.sha256(value).hexdigest()} for name,value in data.items()]
            value={'schema':'public-case-runtime-closure-v1','cases':{'r131-native':{'entrypoint':prefix+'entry.mjs','manifest':prefix+'runtime-publication-manifest.json','manifestSha256':hashlib.sha256(raw).hexdigest(),'assets':assets}}}
            return value,data
        value,data=fixture(manifest);self.assertEqual(verify(WORKFLOW,value,data.__getitem__),1)
        manifest['entry']='missing.mjs';value,data=fixture(manifest)
        with self.assertRaises(ValueError):verify(WORKFLOW,value,data.__getitem__)

if __name__=='__main__':unittest.main()
