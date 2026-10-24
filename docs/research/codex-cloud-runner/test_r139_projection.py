"""Both real projectors on the fixed R139 contract; no app/browser/server imports."""
import copy
import json
from pathlib import Path
import shutil
import subprocess
import unittest
import test_projection_integration as projection

HERE=Path(__file__).resolve().parent
CASES=('ignore','consume','cancel','baseline','candidate')
INTEGER_FIELDS=('observedPostCount','requestOrdinal','targetOrdinal','sessionOrdinal','documentOrdinal','responseStatus','requestIdentityMatched','responseIdentityMatched','bodyUsedOnHeaders','bodyUsedAfterFlush','bodyUsedAtSurvey','bodyReadBytes','flushReturned','cancelComplete','serverAcceptedRequests','serverAcceptedEvents','serverPayloadBytes','serverResponseBytes','serverFinishedByCutoff','serverClosedByCutoff','surveyAfterCutoffUs')

def golden():
    rows={}
    for index,name in enumerate(CASES):
        row={key:None for key in INTEGER_FIELDS};row.update(terminal='unobserved' if name=='ignore' else 'loadingFinished',action='none' if name=='ignore' else 'module' if index>=3 else 'complete',visibility='unknown',consent='unknown',observedPostCount=1,requestOrdinal=index+10,targetOrdinal=index+1,sessionOrdinal=index+1,documentOrdinal=index+1,responseStatus=200,requestIdentityMatched=1,responseIdentityMatched=1,bodyUsedOnHeaders=0,bodyUsedAfterFlush=0 if index in (0,3) else 1,bodyUsedAtSurvey=None,bodyReadBytes=17 if name=='consume' else None,flushReturned=1,cancelComplete=1 if name=='cancel' else 0,serverAcceptedRequests=1,serverAcceptedEvents=1 if index>=3 else 0,serverPayloadBytes=98 if index>=3 else 13,serverResponseBytes=17,serverFinishedByCutoff=1,serverClosedByCutoff=1,surveyAfterCutoffUs=1000);rows[name]=row
    return {'schema':'r139-body-lifecycle-v1','mode':'r139-five-case-component-v1','status':'correct','code':'r139-observation-complete','passed':True,'acceptance':False,'cleanupPassed':True,'sourcePin':'6f22fefa782747790e2eaefa01e4e5ea7b557323','r139HarnessManifestSha256':'38b6213e5657a31a024fffc3618b2629c368e28e8a6154bf9545cdb62495a408','r139BaselineClientSha256':'5a0f33a978030884c187bb4740199efe827bec39a7d3225ed920c1f09990c67a','r139CandidateClientSha256':'6efa06d912fefd93e05877bcdaead28121828c14ccf73d173123c2c0c1ec072e','r139LedgerSha256':'5bad0bff91320fb3ebba510de124bdb98e611d8c1cda4de85e8fb9c9e2fd60c3','nodeSha256':'bc17c508ffeed0ec622934f9b7fa72f8e78da65350e63c3eceb56fa688aa5e12','nodeVersion':'v24.19.0','playwrightVersion':'1.62.1','chromiumVersion':'151.0.7922.34','r139Cases':rows,'metrics':{'r139WindowMs':5000,'r139WindowStartMs':100,'r139CutoffMs':5100,'r139CheckpointCapturedMs':5101,'r139CaseCount':5,'r139CoverageTargets':5,'r139LedgerFaultCount':0,'r139LedgerDropped':0,'r139LedgerPendingWrites':0,'r139PreClosePersisted':1,'r139ClosedPages':5,'r139DetachedSessions':5,'r139BrowserCloseCompleted':1,'r139ServerCloseCompleted':1,'r139OpenFixtureSockets':0}}

class R139ProjectionControls(unittest.TestCase):
    both=projection.BothProjectionControls.both

    def complete(self,value):
        script="import {pathToFileURL} from 'node:url';const {observationComplete}=await import(pathToFileURL(process.argv[1]));let s='';for await(const b of process.stdin)s+=b;process.stdout.write(JSON.stringify(observationComplete(JSON.parse(s))));"
        p=subprocess.run([shutil.which('node'),'--max-old-space-size=128','--input-type=module','-e',script,str(HERE.parent/'codex-cloud-assets/r139/contract.mjs')],input=json.dumps(value,separators=(',',':')),text=True,capture_output=True,timeout=8)
        self.assertEqual(p.returncode,0,'pure mapped contract failed; raw output omitted');return json.loads(p.stdout)

    def test_healthy_five_case_projected_contract_and_nulls_have_exact_python_js_parity(self):
        value=golden();result=self.both([value])[0];self.assertTrue(result['ok']);self.assertTrue(self.complete(result['value']));self.assertEqual(result['value']['r139Cases'],value['r139Cases']);self.assertIsNone(result['value']['r139Cases']['baseline']['bodyUsedAtSurvey']);self.assertFalse(result['value']['acceptance'])

    def test_nullable_body_used_is_never_false_or_zero_substituted(self):
        value=golden();value['r139Cases']['baseline']['bodyUsedAtSurvey']=False
        projected=self.both([value])[0]['value'];self.assertNotIn('bodyUsedAtSurvey',projected['r139Cases']['baseline']);self.assertFalse(self.complete(projected))
        value=golden();value['r139Cases']['baseline']['bodyUsedAtSurvey']=None
        projected=self.both([value])[0]['value'];self.assertIsNone(projected['r139Cases']['baseline']['bodyUsedAtSurvey']);self.assertTrue(self.complete(projected))

    def test_booleans_fractions_range_and_strings_are_not_admitted_as_integer_facts(self):
        values=[]
        for bad in (True,False,1.5,-1,9007199254740992,'SYNTHETIC_SECRET',[],{}):
            value=golden();value['r139Cases']['candidate']['bodyUsedOnHeaders']=bad;values.append(value)
        for result in self.both(values):self.assertTrue(result['ok']);self.assertNotIn('bodyUsedOnHeaders',result['value']['r139Cases']['candidate']);self.assertFalse(self.complete(result['value']))
        value=golden();value['r139Cases']['candidate']['bodyUsedAtSurvey']=2
        projected=self.both([value])[0]['value'];self.assertEqual(projected['r139Cases']['candidate']['bodyUsedAtSurvey'],2);self.assertFalse(self.complete(projected))

    def test_unknown_fields_wrong_nested_types_and_labels_are_dropped(self):
        value=golden();value['rawURL']='SYNTHETIC_SECRET';value['metrics']['unlistedMetric']=1;value['r139Cases']['privateCase']={'body':'SYNTHETIC_SECRET'};value['r139Cases']['ignore']['rawResponse']='SYNTHETIC_SECRET';value['r139Cases']['ignore']['terminal']='SYNTHETIC_SECRET'
        result=self.both([value])[0]['value'];self.assertNotIn('SYNTHETIC_SECRET',json.dumps(result));self.assertEqual(set(result['r139Cases']),set(CASES));self.assertNotIn('terminal',result['r139Cases']['ignore']);self.assertFalse(self.complete(result))
        for bad in ([],False,'SYNTHETIC_SECRET'):
            value=golden();value['r139Cases']=bad;result=self.both([value])[0]['value'];self.assertNotIn('r139Cases',result)

    def test_fixed_nested_maximum_shape_fits_case_and_inner_frame_caps(self):
        value=golden();policy=json.loads((HERE/'result-policy.json').read_text())
        for row in value['r139Cases'].values():
            for key in INTEGER_FIELDS:row[key]=9007199254740991
        for key in policy['metricKeys']:
            if key.startswith('r139'):value['metrics'][key]=999999999999999
        value.update(r139FailureOperation='validate',r139ErrorName='Error',r139ErrorCode='unknown',r139ErrorStackSha256='a'*64)
        result=self.both([value])[0]['value'];result['caseExitCode']=1
        case_bytes=len(json.dumps(result,separators=(',',':')).encode());inner={'schema':'docker-hard-2cpu-6g-result-v1','passed':True,'control':'none','intentionalNegative':False,'samples':512,'cgroupMemoryPeak':6442450944,'rssUnknownSamples':0,'pssUnknownSamples':0,'orphanReaped':True,'caseResult':result}
        inner_bytes=len(json.dumps(inner,separators=(',',':')).encode());self.assertEqual(case_bytes,6212);self.assertEqual(inner_bytes,6435);self.assertLess(inner_bytes,32768)

if __name__=='__main__':unittest.main()
