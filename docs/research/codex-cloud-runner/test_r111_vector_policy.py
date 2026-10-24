"""Tiny pure projector controls; no application, provider, browser or Docker imports."""
import copy
import hashlib
import json
import math
import shutil
import subprocess
import unittest
from pathlib import Path

import r111_vector_policy as host

HERE = Path(__file__).resolve().parent
PROPOSAL_SHA = "619a9f15d9914848d9435e47bfcf7afaaafafe76553b52e96d7b483fb1995c8c"
NODE_SCRIPT = r"""
import {pathToFileURL} from 'node:url';
const v=await import(pathToFileURL(process.argv[1]));
let input='';for await(const bytes of process.stdin)input+=bytes;
const results=[];
for(const request of JSON.parse(input)){
 try{
  if(request.op==='exports'){results.push({ok:true,value:Object.keys(v).sort()});continue;}
  if(request.op==='budget'){v.assertCaseBudget(request.value);results.push({ok:true,bytes:Buffer.byteLength(JSON.stringify(request.value)+'\n')});continue;}
  if(request.op==='complete'){results.push({ok:true,value:v.completeNumericObservation(request.value)});continue;}
  if(request.op==='parse'){results.push({ok:true,value:v.parseEvidenceLines(request.text,request.maxRows??512)});continue;}
  if(request.op==='compact'){results.push({ok:true,value:v.compactEvidence(request.samples,request.journeys)});continue;}
  if(request.op==='nan')request.value.sampleVectors.global[0][0]=NaN;
  const projected=v.projectNumericEvidence(request.value.sampleVectors,request.value.journeyLatencies);
  results.push({ok:true,value:projected});
 }catch{results.push({ok:false});}
}
process.stdout.write(JSON.stringify(results));
"""

def compact_json(value):
    return json.dumps(value, separators=(',', ':'), allow_nan=False)

def maximum_vectors():
    n = 128
    return {
        'sampleVectors': {
            'schema': 1, 'tMs': [1980000-n+i+1 for i in range(n)],
            'global': [host.GLOBAL_MAX[:] for _ in range(n)],
            'surfaces': [
                {'page': page, 'values': [[None if i in (4,5,7) else value for i,value in enumerate(host.SURFACE_MAX)] for _ in range(n)],
                 'unknown': [0,0,0,0,n,n,0,n]} for page in range(3)],
            'unknown': [0,0,0,0], 'dropped': 512},
        'journeyLatencies': {
            'schema': 1, 'rows': [[i,5,1,*host.JOURNEY_MAX[3:]] for i in range(54)],
            'unknown': [0,0,0,0], 'dropped': 512}}

def empty_vectors():
    return {'sampleVectors': {'schema':1,'tMs':[],'global':[],
             'surfaces':[{'page':i,'values':[],'unknown':[0]*8} for i in range(3)],
             'unknown':[0]*4,'dropped':0},
            'journeyLatencies':{'schema':1,'rows':[],'unknown':[0]*4,'dropped':0}}

def complete_vectors():
    value = empty_vectors()
    sample = value['sampleVectors']
    sample.update({'tMs':[0,1800000],'global':[[None]*4 for _ in range(2)],'unknown':[2]*4})
    for page in sample['surfaces']:
        page.update(values=[[None]*8 for _ in range(2)],unknown=[2]*8)
    value['journeyLatencies'].update(rows=[[i,i%6,(i//6)%2,0,1,None,2] for i in range(54)],unknown=[0,0,54,0])
    return value

def maximum_rtt_evidence():
    return {'schema':1,'directNodeUs':[90000000]*10,'proxyNodeUs':[90000000]*20,
            'browserProxyUs':[90000000]*10,'unknown':[0,0,0]}

def actual_near_maximum_case():
    # Exact source test shape from candidate/tests/evidence-vectors.test.mjs,
    # including source publicResult's forced-code cleanup status and field order.
    value = {
        'schema':'r111-long-session-v2','mode':'r111-public-duo-session-v2',
        'status':'blocked','code':'r111-source-slice-observed','passed':False,
        'acceptance':False,'cleanupPassed':False,
        'sourcePin':'6f22fefa782747790e2eaefa01e4e5ea7b557323',
        'fixtureSha256':'a672a1f9b5de6a699a18c26c5fad6fe477a5e37d05c75f115f425a8a3f789b09',
        'scope':{'dataset':'duo-legacy','fixtureBaseline':'r37-authored-711-v2','players':2,
                 'overlays':1,'memberUnlockedChunks':1,'taskCoverage':'fixture-member-catalogue','sessionMinutes':30},
        'openGates':['fault-recovery','latest-generation','physical-paint','independent-engine-correctness',
                     'full-legacy-coverage','memory-nonaccumulation','statistical-performance'],
        'metrics':{'targetDurationMs':1800000,'elapsedMs':1999999.9999999998,
                   'timedDurationMs':1809999.9999999998,'observedTimedDurationMs':1814999.9999999998,
                   'operations':54,'mutations':45,'closedPages':3,'networkPending':0},
        'sourceManifestSha256':'a'*64,'harnessManifestSha256':'b'*64,'nodeSha256':'c'*64}
    value.update(maximum_vectors())
    value['rttEvidence']=maximum_rtt_evidence()
    return value

class R111VectorPolicy(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.node = shutil.which('node')
        if not cls.node:
            raise RuntimeError('Node is required for the explicit pure parity controls')

    def node_requests(self, requests):
        result = subprocess.run([self.node,'--max-old-space-size=128','--input-type=module','-e',NODE_SCRIPT,str(HERE/'r111_vectors.mjs')],
                                input=compact_json(requests),text=True,capture_output=True,timeout=8)
        self.assertEqual(result.returncode,0,'Pure Node projector subprocess failed; raw output deliberately omitted')
        self.assertLess(len(result.stdout.encode()),512*1024)
        return json.loads(result.stdout)

    def projected(self, value):
        return host.project_numeric_evidence(value['sampleVectors'],value['journeyLatencies'])

    def test_source_receipt_and_copies_are_exact(self):
        receipt=json.loads((HERE/'r111-projector-source-receipt.json').read_text())
        self.assertEqual(receipt['sourceProposalSha256'],PROPOSAL_SHA)
        self.assertTrue(receipt['byteIdentical'])
        self.assertEqual(len(receipt['files']),2)
        for row in receipt['files']:
            data=(HERE/row['copy']).read_bytes()
            self.assertEqual(len(data),row['bytes'])
            self.assertEqual(hashlib.sha256(data).hexdigest(),row['sourceSha256'])
            self.assertEqual(row['sourceSha256'],row['copySha256'])

    def test_exact_public_js_exports_and_python_api(self):
        result=self.node_requests([{'op':'exports'}])[0]
        self.assertEqual(result['value'],sorted(['VECTOR_POLICY','projectNumericEvidence','compactEvidence',
             'parseEvidenceLines','assertCaseBudget','completeNumericObservation']))
        self.assertTrue(callable(host.project_numeric_evidence))

    def test_js_to_python_exact_parity_empty_complete_and_maximum(self):
        values=[empty_vectors(),complete_vectors(),maximum_vectors()]
        results=self.node_requests([{'value':value} for value in values])
        for original,result in zip(values,results):
            self.assertTrue(result['ok'])
            self.assertEqual(result['value'],original)
            self.assertEqual(self.projected(result['value']),result['value'])

    def test_python_projection_returns_independent_structures(self):
        original=maximum_vectors(); projected=self.projected(original)
        projected['sampleVectors']['global'][0][0]=0
        self.assertEqual(original['sampleVectors']['global'][0][0],host.GLOBAL_MAX[0])

    def test_near_maximum_actual_case_and_envelope_fit(self):
        case=actual_near_maximum_case()
        envelope={'schema':'docker-hard-2cpu-6g-result-v1','passed':True,'control':'none',
                  'intentionalNegative':False,'samples':10000,'cgroupMemoryPeak':6442450944,
                  'rssUnknownSamples':10000,'pssUnknownSamples':10000,'orphanReaped':True,'caseResult':case}
        results=self.node_requests([{'op':'budget','value':case},{'op':'budget','value':envelope}])
        self.assertEqual([row['bytes'] for row in results],[31173,31406])
        self.assertTrue(all(row['ok'] for row in results))
        self.assertEqual(len((compact_json(case)+'\n').encode()),31173)
        self.assertEqual(len((compact_json(envelope)+'\n').encode()),31406)
        self.assertEqual(self.projected(case),maximum_vectors())

    def test_case_budget_rejects_oversize_serialized_result(self):
        case=actual_near_maximum_case(); case['extra']='x'*32768
        self.assertEqual(self.node_requests([{'op':'budget','value':case}]),[{'ok':False}])

    def test_points_journeys_schemas_and_shapes_rejected_by_both(self):
        mutations=[
            lambda v:v['sampleVectors'].__setitem__('schema',0),
            lambda v:v['sampleVectors'].__setitem__('schema',True),
            lambda v:v['sampleVectors']['tMs'].append(1980000),
            lambda v:v['sampleVectors']['tMs'].__setitem__(1,v['sampleVectors']['tMs'][0]),
            lambda v:v['sampleVectors']['tMs'].__setitem__(0,-1),
            lambda v:v['sampleVectors']['tMs'].__setitem__(-1,1980001),
            lambda v:v['sampleVectors']['global'][0].append(0),
            lambda v:v['sampleVectors']['surfaces'].append(copy.deepcopy(v['sampleVectors']['surfaces'][0])),
            lambda v:v['sampleVectors']['surfaces'][1].__setitem__('page',0),
            lambda v:v['journeyLatencies'].__setitem__('schema',0),
            lambda v:v['journeyLatencies']['rows'].append(v['journeyLatencies']['rows'][-1][:]),
            lambda v:v['journeyLatencies']['rows'][1].__setitem__(0,0),
            lambda v:v['journeyLatencies']['rows'][0].__setitem__(0,None),
            lambda v:v['journeyLatencies']['rows'][0].__setitem__(1,6),
            lambda v:v['journeyLatencies']['rows'][0].__setitem__(2,2),
            lambda v:v['sampleVectors'].__setitem__('dropped',513),
            lambda v:v['journeyLatencies'].__setitem__('dropped',-1)]
        values=[]
        for mutate in mutations:
            value=maximum_vectors();mutate(value);values.append(value)
            with self.assertRaises((ValueError,TypeError,KeyError,IndexError)):self.projected(value)
        self.assertEqual(self.node_requests([{'value':value} for value in values]),[{'ok':False}]*len(values))

    def test_numeric_type_range_and_null_count_rejections(self):
        values=[]
        for replacement in (-1,False,1.5,'SYNTHETIC_PRIVATE_VALUE',host.GLOBAL_MAX[0]+1):
            value=maximum_vectors();value['sampleVectors']['global'][0][0]=replacement;values.append(value)
        for path in ('global','surface','journey'):
            value=maximum_vectors()
            if path=='global':value['sampleVectors']['unknown'][0]=1
            elif path=='surface':value['sampleVectors']['surfaces'][0]['unknown'][4]=0
            else:value['journeyLatencies']['unknown'][0]=1
            values.append(value)
        for value in values:
            with self.assertRaises(ValueError):self.projected(value)
        self.assertEqual(self.node_requests([{'value':value} for value in values]),[{'ok':False}]*len(values))
        value=maximum_vectors();value['sampleVectors']['global'][0][0]=math.nan
        with self.assertRaises(ValueError):self.projected(value)
        self.assertEqual(self.node_requests([{'op':'nan','value':maximum_vectors()}]),[{'ok':False}])

    def test_private_keys_cannot_enter_any_structured_surface(self):
        values=[]
        for branch in ('sample','surface','journey'):
            value=maximum_vectors()
            target=value['sampleVectors'] if branch=='sample' else value['sampleVectors']['surfaces'][0] if branch=='surface' else value['journeyLatencies']
            target['privateURL']='https://synthetic.invalid/?token=SYNTHETIC_PRIVATE_VALUE';values.append(value)
        for value in values:
            with self.assertRaises(ValueError):self.projected(value)
        self.assertEqual(self.node_requests([{'value':value} for value in values]),[{'ok':False}]*len(values))

    def test_existing_schema_fallback_drops_vectors_without_changing_scalars(self):
        import docker_envelope
        baseline={'schema':'r116-frozen-browser-v1','status':'blocked','passed':False,'metrics':{'allDomMs':12.5}}
        value=copy.deepcopy(baseline)
        value['sampleVectors']={'privateURL':'https://synthetic.invalid/SYNTHETIC_PRIVATE_VALUE'}
        value['journeyLatencies']={'private':'SYNTHETIC_PRIVATE_VALUE'}
        self.assertEqual(docker_envelope.sanitized_result(value),docker_envelope.sanitized_result(baseline))
        self.assertNotIn('SYNTHETIC_PRIVATE_VALUE',compact_json(docker_envelope.sanitized_result(value)))

    def test_complete_observation_requires_schedule_and_span(self):
        values=[complete_vectors()]
        for change in ('missing','kind','actor','dropped','short'):
            value=complete_vectors()
            if change=='missing':value['journeyLatencies']['rows'].pop()
            elif change=='kind':value['journeyLatencies']['rows'][0][1]=5
            elif change=='actor':value['journeyLatencies']['rows'][0][2]=1
            elif change=='dropped':value['sampleVectors']['dropped']=1
            else:value['sampleVectors']['tMs'][-1]=1700000
            values.append(value)
        results=self.node_requests([{'op':'complete','value':value} for value in values])
        self.assertEqual([row['value'] for row in results],[True,False,False,False,False,False])

    def test_compaction_and_malformed_json_lines_preserve_unknown(self):
        results=self.node_requests([
            {'op':'compact','samples':[{'at':0},{'at':5000},{'at':15000}],'journeys':[]},
            {'op':'parse','text':'{"at":0}\n{"private":"SYNTHETIC_PRIVATE_VALUE"\n'}])
        value=results[0]['value']
        self.assertEqual(value['sampleVectors']['tMs'],[0,15000])
        self.assertEqual(value['sampleVectors']['unknown'],[2]*4)
        self.assertEqual(self.projected(value),value)
        self.assertEqual(results[1]['value'],{'rows':[{'at':0}],'dropped':1})
        self.assertNotIn('SYNTHETIC_PRIVATE_VALUE',compact_json(results))

if __name__=='__main__':unittest.main()
