"""Tiny checks of both real projectors against fixed performance result fields."""
import copy
import json
from pathlib import Path
import unittest
import test_projection_integration as projection
from test_r111_vector_policy import actual_near_maximum_case,compact_json

HERE=Path(__file__).resolve().parent

class PerformanceProjectionControls(unittest.TestCase):
    both=projection.BothProjectionControls.both

    def test_r134_all126_fields_and_signed_derived_values_survive_both(self):
        policy=json.loads((HERE/'result-policy.json').read_text())
        keys=[k for k in policy['metricKeys'] if k.startswith('r134_')]
        self.assertEqual(len(keys),126)
        value={'schema':'r134-engine-performance-v1','mode':'r134-owner-evaluate-screen-v1','status':'correct','passed':True,'code':'r134-screen-complete','count':48,'gainBeyondNoise':False,'screenStatus':'parked','metrics':{k:(-0.25 if 'Regression' in k or 'Gain' in k else 100) for k in keys}}
        for key in policy['enums']:
            if key.startswith('r134_') and key.endswith('_classification'):value[key]='regression-observed'
        for key in ('r134PacketManifestSha256','r134ProviderProofSha256','r134RawVectorsSha256'):value[key]='a'*64
        result=self.both([value])[0]
        self.assertTrue(result['ok']);self.assertEqual(result['value']['metrics'],value['metrics'])
        self.assertFalse(result['value']['gainBeyondNoise']);self.assertEqual(result['value']['screenStatus'],'parked')
        self.assertLess(len(json.dumps(result['value'],separators=(',',':')).encode()),32768)

    def test_r135_optional_warm_and_partial_failure_counts_are_retained(self):
        value={'schema':'r135-http-component-v1','status':'failed','passed':False,'cleanupPassed':False,'count':3,'elapsedMs':500,'sourceCommit':'6f22fefa782747790e2eaefa01e4e5ea7b557323','metrics':{'r135Cell0ReadyMs':10,'r135Cell0FirstBodyMs':20,'r135Cell0WarmBodyMs':5}}
        result=self.both([value])[0]['value'];self.assertEqual(result['metrics'],value['metrics']);self.assertEqual(result['count'],3);self.assertFalse(result['passed'])

    def test_unexpected_keys_labels_and_secrets_are_omitted_from_both(self):
        value={'schema':'r134-engine-performance-v1','metrics':{'r134_aa0_p0_coldMs':10,'PRIVATE_TOKEN':777,'r134_unreviewed_label':42},'r134RawVectorsSha256':'https://example.invalid/?token=SYNTHETIC_SECRET','rawError':'SYNTHETIC_SECRET','screenStatus':'SYNTHETIC_SECRET'}
        result=self.both([value])[0]['value'];self.assertEqual(result['metrics'],{'r134_aa0_p0_coldMs':10});self.assertNotIn('SYNTHETIC_SECRET',json.dumps(result));self.assertNotIn('rawError',result)

    def test_r135_first_failure_operation_counts_and_hash_survive_closed_projection(self):
        diagnostic={'operationCode':'r135-first-request','cellOrdinal':3,'errorName':'assertion-error','errorCode':'ERR_ASSERTION','errorStackSha256':'b'*64,'completedCellCount':3}
        value={'schema':'r135-http-component-v1','status':'failed','passed':False,'count':3,**diagnostic}
        result=self.both([value])[0]['value']
        for key,item in diagnostic.items():self.assertEqual(result[key],item)
        value.update(cellOrdinal=None,errorStackSha256=None);result=self.both([value])[0]['value'];self.assertIsNone(result['cellOrdinal']);self.assertIsNone(result['errorStackSha256'])
        value.update(operationCode='SYNTHETIC_SECRET',errorCode='TOKEN=SYNTHETIC_SECRET',errorName='SYNTHETIC_SECRET',errorStackSha256='SYNTHETIC_SECRET',cellOrdinal=True,completedCellCount=-1)
        result=self.both([value])[0]['value'];self.assertTrue(all(key not in result for key in diagnostic));self.assertNotIn('SYNTHETIC_SECRET',json.dumps(result))

    def test_r134_first_failure_binds_known_cell_and_distinct_partial_counts(self):
        diagnostic={'r134FailureOperation':'case-descriptor-oracle','r134FailureErrorName':'AssertionError','r134FailureErrorCode':'ERR_ASSERTION','r134FailureStackSha256':'c'*64,'r134FailureProcessOrdinal':2,'r134FailureCellOrdinal':9,'r134ObservedTimedSamples':10,'r134ObservedVerifiedSamples':9,'r134CompletedProcesses':2}
        value={'schema':'r134-engine-performance-v1','status':'failed','passed':False,'code':'runtime-error',**diagnostic}
        result=self.both([value])[0]['value']
        for key,item in diagnostic.items():self.assertEqual(result[key],item)
        for key in ('r134FailureCellOrdinal','r134ObservedTimedSamples'):value.pop(key)
        result=self.both([value])[0]['value'];self.assertNotIn('r134FailureCellOrdinal',result);self.assertNotIn('r134ObservedTimedSamples',result)
        value.update(r134FailureOperation='SYNTHETIC_SECRET',r134FailureErrorName='SYNTHETIC_SECRET',r134FailureErrorCode='SYNTHETIC_SECRET',r134FailureStackSha256='SYNTHETIC_SECRET')
        self.assertNotIn('SYNTHETIC_SECRET',json.dumps(self.both([value])[0]['value']))

    def test_changed_browser_native_and_maximum_soak_diagnostics_are_retained(self):
        browser={'schema':'r116-frozen-browser-v1','status':'failed','code':'reference-section-ready-timeout','openingCode':'opening-section-ready-timeout','failureOperation':'reference-section-ready-wait'}
        native={'schema':'r131-borrow-native-v1','status':'failed','r131DiagnosticOperation':'phase-proof','r131DiagnosticIntent':'declaration','r131DiagnosticMode':'thread','r131DiagnosticOutcome':'failed','r131DiagnosticErrorName':'AssertionError','r131DiagnosticErrorCode':'ERR_ASSERTION','r131DiagnosticErrorSha256':'a'*64,'r131DiagnosticEventsSha256':'b'*64,'metrics':{'r131ObservedEpisodeCount':3,'r131PassedEpisodeCount':2}}
        soak=actual_near_maximum_case();soak.update(status='failed',code='r111-child-nonzero',r111Operation='browser-launch',r111ErrorName='Error',r111ErrorCode='ENOENT',r111ErrorStackSha256='a'*64,r111ChildStdoutSha256='b'*64,r111ChildStderrSha256='c'*64);soak['metrics'].update(r111ChildStdoutBytes=123,r111ChildStderrBytes=456)
        result=self.both([browser,native,soak]);self.assertTrue(all(row['ok'] for row in result))
        self.assertEqual(result[0]['value']['failureOperation'],browser['failureOperation']);self.assertEqual(result[0]['value']['code'],browser['code']);self.assertEqual(result[1]['value']['metrics'],native['metrics'])
        projected=result[2]['value'];self.assertEqual(projected['code'],'r111-child-nonzero');self.assertEqual(projected['r111ErrorCode'],'ENOENT');self.assertEqual(projected['sampleVectors'],soak['sampleVectors']);self.assertFalse(projected['acceptance'])
        self.assertLess(len((compact_json(projected)+'\n').encode())+250,32768)

    def test_recovery_r135_preserves_exact_zero_change94record_provider_evidence(self):
        digest='3cbb39538d6d5c50cc04308a709771af2fbf23bd0da56499e076645b2be9a5c9';records='3149f86d99755116b57e1a5e4dbdb1437c4763ecf602a8a741454988441e51c4'
        fields={'providerChangedRecordCount':0,'providerExpectedChangedRecordCount':0,'providerActualRecordCount':94,'providerActualInputCount':61,'providerActualEvidenceCount':33,'providerExpectedDigest':digest,'providerActualDigest':digest,'providerExpectedRecordsSha256':records,'providerActualRecordsSha256':records}
        value={'schema':'r135-http-component-v1','status':'failed','passed':False,**fields};result=self.both([value])[0]['value']
        for key,item in fields.items():self.assertEqual(result[key],item)
        value.update(providerActualDigest='SYNTHETIC_SECRET',providerChangedRecordCount=True);result=self.both([value])[0]['value'];self.assertNotIn('providerActualDigest',result);self.assertNotIn('providerChangedRecordCount',result)

    def test_recovery_r116_close_receipts_are_closed_nullable_diagnostics(self):
        policy=json.loads((HERE/'result-policy.json').read_text());rules=policy['caseDiagnosticFields']['r116-frozen-browser-v1']['referenceCloseDiagnostic']['fields']
        diagnostic={key:(rule['enum'][0] if 'enum' in rule else None) for key,rule in rules.items()};diagnostic.update(attemptStatus='failed',stopRpcStatus='rejected',stopErrorCode='CHILD_RPC_TIMEOUT',elapsedMs=15,pendingRpcCount=1)
        value={'schema':'r116-frozen-browser-v1','status':'failed','code':'runtime-error','referenceCloseDiagnostic':diagnostic,'measuredCloseDiagnostic':diagnostic}
        result=self.both([value])[0]['value'];self.assertEqual(result['referenceCloseDiagnostic'],diagnostic);self.assertEqual(result['measuredCloseDiagnostic'],diagnostic);self.assertEqual(result['code'],'runtime-error')
        value['referenceCloseDiagnostic']={**diagnostic,'rawError':'SYNTHETIC_SECRET','stopErrorCode':'SYNTHETIC_SECRET','elapsedMs':True}
        result=self.both([value])[0]['value'];self.assertNotIn('rawError',result['referenceCloseDiagnostic']);self.assertNotIn('stopErrorCode',result['referenceCloseDiagnostic']);self.assertNotIn('elapsedMs',result['referenceCloseDiagnostic'])

    def test_recovery_r111_public_frame_and_r125_native_failure_observations(self):
        soak=actual_near_maximum_case();soak.update(status='failed',code='r111-child-nonzero',r111Operation='server-fixture-state',r111SourceModule='app/core/state.mjs');soak['metrics'].update(r111SourceLine=42,r111SourceColumn=3)
        native={'schema':'r125-focus-functional-v1','status':'failed','passed':False,'focusNativeExitObserved':True,'focusNativeSummaryObserved':False,'focusNativeDiagnosticObserved':True,'focusNativeOutputComplete':True,'focusNativeSignal':'none','focusNativeFailureKind':'fixture-failure','focusNativeFailureOperation':'setup','focusNativeFailureName':'TypeError','focusNativeFailureCode':'ERR_TEST_FAILURE','focusNativeFailureModule':'tests/task-focus-native-v4.fixture.mjs','metrics':{'focusNativeExitCode':1,'focusNativeCaseStartCount':1,'focusNativeCaseEndCount':0,'focusNativeFailureLine':5,'focusNativeFailureColumn':3}}
        result=self.both([soak,native]);self.assertTrue(all(row['ok'] for row in result));self.assertEqual(result[0]['value']['r111SourceModule'],'app/core/state.mjs');self.assertFalse(result[0]['value']['acceptance']);self.assertEqual(result[1]['value']['metrics'],native['metrics']);self.assertEqual(result[1]['value']['focusNativeFailureCode'],'ERR_TEST_FAILURE')
        self.assertLess(len((compact_json(result[0]['value'])+'\n').encode())+250,32768)
        native.update(focusNativeFailureModule='C:/SYNTHETIC_SECRET',focusNativeFailureCode='SYNTHETIC_SECRET');self.assertNotIn('SYNTHETIC_SECRET',json.dumps(self.both([native])[0]['value']))

if __name__=='__main__':unittest.main()
