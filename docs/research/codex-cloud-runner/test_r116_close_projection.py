"""Source-only projection of diagnostic identity/phase data; never imports the app."""
import json
from pathlib import Path
import unittest
import test_projection_integration as projection
from accept_case import accepted

HERE=Path(__file__).resolve().parent
class CloseObservationProjectionControls(unittest.TestCase):
    both=projection.BothProjectionControls.both
    def observation(self):
        policy=json.loads((HERE/'result-policy.json').read_text());rules=policy['caseDiagnosticFields']['r116-app-close-diagnostic-v1'];identity={k:('a'*64 if r.get('type')=='sha256-or-null' else r['enum'][0] if 'enum' in r else 1928) for k,r in rules['closeObservationIdentity']['fields'].items()}
        def sample(rule):
            if 'enum' in rule:return rule['enum'][0]
            if rule.get('type')=='closed-object':return{k:sample(v) for k,v in rule['fields'].items()}
            return None
        return{'schema':'r116-app-close-diagnostic-v1','mode':'r116-close-phases-observation-v1','status':'blocked','code':'r116-close-observation-complete','passed':False,'acceptance':False,'closeObservationIdentity':identity,'closePhaseDiagnostic':sample(rules['closePhaseDiagnostic'])}
    def test_observation_schema_preserves_false_identity_nulls_and_nested_phases_both(self):
        value=self.observation();result=self.both([value])[0]['value'];self.assertEqual(result['closeObservationIdentity'],value['closeObservationIdentity']);self.assertEqual(result['closePhaseDiagnostic'],value['closePhaseDiagnostic']);self.assertFalse(result['passed']);self.assertFalse(result['acceptance']);self.assertFalse(accepted({'passed':True,'cleanupPassed':True,'result':{'caseResult':result}},'r116'))
    def test_closed_nested_types_drop_private_unknown_and_bool_numbers(self):
        value=self.observation();value['closeObservationIdentity'].update(originalServerSha256='SYNTHETIC_SECRET',fileCount=True,rawPath='SYNTHETIC_SECRET');value['closePhaseDiagnostic'].update(events=True,rawMessage='SYNTHETIC_SECRET');value['closePhaseDiagnostic']['states']['serverAll']='SYNTHETIC_SECRET';result=self.both([value])[0]['value'];self.assertNotIn('SYNTHETIC_SECRET',json.dumps(result));self.assertNotIn('fileCount',result['closeObservationIdentity']);self.assertNotIn('events',result['closePhaseDiagnostic'])

if __name__=='__main__':unittest.main()
