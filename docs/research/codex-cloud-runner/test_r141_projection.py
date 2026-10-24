"""Both actual public sanitizers; no application or case entrypoint imports."""
import json
from pathlib import Path
import unittest
import test_projection_integration as projection

HERE=Path(__file__).resolve().parent
CONTRACT=json.loads((HERE.parent/'codex-cloud-assets/r141/case-contract.json').read_text())
SCHEMA='r141-planning-stage-diagnostic-v1'
SCALARS=('diagnosticOnly','acceptance','performanceAcceptance','productAcceptance','sourcePostflightPassed','r141AReadyOmissionObserved','r141CReadyOmissionObserved')

def projected_fixture(all_metrics=True):
    value={'schema':SCHEMA,'status':'correct','code':'r141-diagnostic-complete','passed':True,'cleanupPassed':True,'sourceCommit':CONTRACT['sourcePin'],'allFinalGates':'OPEN',
           'diagnosticOnly':True,'acceptance':False,'performanceAcceptance':False,'productAcceptance':False,'sourcePostflightPassed':True,'r141AReadyOmissionObserved':False,'r141CReadyOmissionObserved':True,'metrics':{key:1 for key in CONTRACT['metricKeys']} if all_metrics else {}}
    for arm in ('A','C'):
        prefix='r141'+arm
        value.update({prefix+'Transport':'json-full',prefix+'BaselineState':'miss',prefix+'IndexState':'hit',prefix+'InstrumentedProofSha256':CONTRACT['proofSha256'][arm],prefix+'ObservedModuleProofSha256':CONTRACT['observedModuleProofSha256'][arm],prefix+'TraceSha256':'a'*64})
    value.update(operationCode='r141-source-proof',cellOrdinal=1,completedCellCount=2,errorName='assertion-error',errorCode='ERR_ASSERTION',errorStackSha256=None,
                 providerChangedRecordCount=0,providerExpectedChangedRecordCount=0,providerActualRecordCount=94,providerActualInputCount=61,providerActualEvidenceCount=33,
                 providerExpectedDigest=CONTRACT['providerDigest'],providerActualDigest=CONTRACT['providerDigest'],providerExpectedRecordsSha256=CONTRACT['providerRecordsSha256'],providerActualRecordsSha256=CONTRACT['providerRecordsSha256'],
                 r141PacketManifestSha256='94975a1dd77befd33995bbdc00fbc3303a6fb0ef5df5b30518fe681b4096e9c6')
    return value

class R141ProjectionControls(unittest.TestCase):
    both=projection.BothProjectionControls.both

    def test_all_128_fixed_metrics_seven_boolean_scalars_and_closed_facts_survive(self):
        value=projected_fixture();result=self.both([value])[0]
        self.assertTrue(result['ok']);out=result['value'];self.assertEqual(len(out['metrics']),128);self.assertEqual(out['metrics'],value['metrics'])
        for key in SCALARS:self.assertIs(out[key],value[key])
        for key in ('cellOrdinal','completedCellCount','providerActualRecordCount','providerActualDigest','r141ATransport','r141CBaselineState','r141AInstrumentedProofSha256','errorStackSha256'):self.assertEqual(out[key],value[key])

    def test_optional_metrics_preserve_absence_and_do_not_conflate_null_or_zero(self):
        value=projected_fixture()
        for key in ('r141CWorkerReadySerializationMs','r141AWorkerEvaluateFullMs','r141CWorkerEvaluateFullMs'):value['metrics'].pop(key)
        value['r141ABaselineState']='hit';value['r141CBaselineState']='hit'
        out=self.both([value])[0]['value']
        for key in ('r141CWorkerReadySerializationMs','r141AWorkerEvaluateFullMs','r141CWorkerEvaluateFullMs'):self.assertNotIn(key,out['metrics'])
        value['metrics']['r141AWorkerEvaluateFullMs']=None;value['metrics']['r141CWorkerEvaluateFullMs']=0
        out=self.both([value])[0]['value'];self.assertNotIn('r141AWorkerEvaluateFullMs',out['metrics']);self.assertEqual(out['metrics']['r141CWorkerEvaluateFullMs'],0)
        # Projection preserves facts; the separate mapped host predicate rejects invented spans.

    def test_every_metric_rejects_boolean_string_null_and_object_payloads(self):
        for bad in (True,'SYNTHETIC_SECRET',None,{},[]):
            values=[{'schema':SCHEMA,'metrics':{key:bad}} for key in CONTRACT['metricKeys']]
            for row in self.both(values):self.assertTrue(row['ok']);self.assertFalse(row['value'].get('metrics'))

    def test_closed_enums_hashes_and_nullable_integer_diagnostics_do_not_leak_raw_values(self):
        value=projected_fixture(False);value.update(rawStack='SYNTHETIC_SECRET',rawURL='SYNTHETIC_SECRET',rawTrace={'body':'SYNTHETIC_SECRET'})
        value['metrics']['privateField']=3
        for key in ('operationCode','errorName','errorCode','r141ATransport','r141CBaselineState','r141CIndexState','r141AInstrumentedProofSha256','providerActualDigest'):value[key]='SYNTHETIC_SECRET'
        value['cellOrdinal']=True;value['completedCellCount']=1.5;value['providerActualInputCount']=-1;value['errorStackSha256']=None
        out=self.both([value])[0]['value'];self.assertNotIn('SYNTHETIC_SECRET',json.dumps(out))
        for key in ('cellOrdinal','completedCellCount','providerActualInputCount','rawTrace','rawStack','rawURL'):self.assertNotIn(key,out)
        self.assertIsNone(out['errorStackSha256'])
        value={'schema':SCHEMA,'cellOrdinal':None,'completedCellCount':None,'providerActualRecordCount':None,'r141ATraceSha256':None}
        out=self.both([value])[0]['value']
        for key in ('cellOrdinal','completedCellCount','providerActualRecordCount','r141ATraceSha256'):self.assertIsNone(out[key])

    def test_diagnostic_fields_remain_schema_scoped_and_all_scalar_secret_strings_drop(self):
        value=projected_fixture(False);value['schema']='r130-codec-functional-v1'
        out=self.both([value])[0]['value']
        for key in ('r141ATransport','r141ATraceSha256','providerActualRecordCount','r141PacketManifestSha256'):self.assertNotIn(key,out)
        value=projected_fixture(False)
        for key in SCALARS:value[key]='SYNTHETIC_SECRET'
        out=self.both([value])[0]['value'];self.assertNotIn('SYNTHETIC_SECRET',json.dumps(out))
        for key in SCALARS:self.assertNotIn(key,out)

    def test_maximum_closed_metric_shape_fits_actual_case_and_inner_frame(self):
        value=projected_fixture()
        for key in value['metrics']:value['metrics'][key]=999999999999999
        out=self.both([value])[0]['value'];out['caseExitCode']=0
        inner={'schema':'docker-hard-2cpu-6g-result-v1','passed':True,'control':'none','intentionalNegative':False,'samples':10000,'cgroupMemoryPeak':6442450944,'rssUnknownSamples':10000,'pssUnknownSamples':10000,'orphanReaped':True,'caseResult':out}
        self.assertLess(len((json.dumps(out,separators=(',',':'))+'\n').encode()),32768)
        self.assertLess(len((json.dumps(inner,separators=(',',':'))+'\n').encode()),32768)

if __name__=='__main__':unittest.main()
