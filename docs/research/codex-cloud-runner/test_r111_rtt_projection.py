"""Strict numeric RTT projection/parity controls; no application or browser imports."""
import copy
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import unittest
import r111_rtt_policy as rtt
import test_projection_integration as projection
from test_r111_vector_policy import actual_near_maximum_case,compact_json,empty_vectors,maximum_rtt_evidence

HERE=Path(__file__).resolve().parent
NODE=r"""
import {pathToFileURL} from 'node:url';
const v=await import(pathToFileURL(process.argv[1]));let raw='';for await(const b of process.stdin)raw+=b;
process.stdout.write(JSON.stringify(JSON.parse(raw).map(value=>{try{return{ok:true,value:v.projectRttEvidence(value),complete:v.completeRttEvidence(value)};}catch{return{ok:false};}})));
"""

class R111RttProjection(unittest.TestCase):
    both=projection.BothProjectionControls.both

    def nodes(self,values):
        node=shutil.which('node');self.assertTrue(node)
        p=subprocess.run([node,'--max-old-space-size=128','--input-type=module','-e',NODE,str(HERE/'r111_rtt_evidence.mjs')],input=compact_json(values),text=True,capture_output=True,timeout=8)
        self.assertEqual(p.returncode,0,'pure RTT helper failed; raw output omitted');return json.loads(p.stdout)

    def case(self,evidence):
        value=actual_near_maximum_case();value.update(empty_vectors());value.update(status='failed',code='r111-child-nonzero',rttEvidence=evidence);return value

    def test_exact_source_copies_and_resource_remainder_hashes(self):
        receipt=json.loads((HERE/'r111-rtt-projector-source-receipt.json').read_text())
        self.assertEqual(receipt['sourceProposalSha256'],'aeacfc0bcc7e77a0368ba4990bd632324c39c102fcde2401e1b722644b9d5852')
        for row in receipt['files']:
            raw=(HERE/row['copy']).read_bytes();self.assertEqual(len(raw),row['bytes']);self.assertEqual(hashlib.sha256(raw).hexdigest(),row['sourceSha256']);self.assertEqual(row['sourceSha256'],row['copySha256'])
        for row in receipt['resourceRemainder']:
            raw=(HERE/row['path']).read_bytes()
            if row['path']=='docker_envelope.py':
                raw=raw.replace(b'from r111_rtt_policy import project_rtt_evidence\n',b'');start=raw.index(b'def sanitized_result(value):');end=raw.index(b'\ndef bounded_bytes(',start)
            else:
                raw=raw.replace(b"import { projectRttEvidence } from './r111_rtt_evidence.mjs';\n",b'');start=raw.index(b'function sanitized(value) {');end=raw.index(b'\nfunction boundedCaseResult(',start)
            remainder=raw[:start]+raw[end:];self.assertEqual(hashlib.sha256(remainder).hexdigest(),row['baseResourceRemainderSha256']);self.assertEqual(row['baseResourceRemainderSha256'],row['newResourceRemainderSha256'])

    def test_complete_empty_partial_and_null_values_have_exact_js_python_parity(self):
        complete=maximum_rtt_evidence();empty={'schema':1,'directNodeUs':[],'proxyNodeUs':[],'browserProxyUs':[],'unknown':[0,0,0]}
        partial={'schema':1,'directNodeUs':[0,None,1234],'proxyNodeUs':[40000,40100],'browserProxyUs':[],'unknown':[1,0,0]}
        values=[complete,empty,partial];js=self.nodes(values)
        for value,row in zip(values,js):self.assertTrue(row['ok']);self.assertEqual(row['value'],value);self.assertEqual(rtt.project_rtt_evidence(value),value);self.assertEqual(rtt.complete_rtt_evidence(value),row['complete'])
        self.assertEqual([row['complete'] for row in js],[True,False,False])

    def test_malformed_evidence_rejected_by_helpers_and_both_actual_sanitizers(self):
        values=[]
        for name in ('extra','schema-bool','missing','duration-bool','fraction','negative','overrange','string','unknown-bool','unknown-mismatch','unknown-extra','overlong','not-array'):
            v=maximum_rtt_evidence()
            if name=='extra':v['private']='SYNTHETIC_SECRET'
            elif name=='schema-bool':v['schema']=True
            elif name=='missing':v.pop('browserProxyUs')
            elif name=='unknown-bool':v['unknown'][0]=False
            elif name=='unknown-mismatch':v['unknown'][0]=1
            elif name=='unknown-extra':v['unknown'].append(0)
            elif name=='overlong':v['directNodeUs'].append(1)
            elif name=='not-array':v['proxyNodeUs']={}
            else:v['proxyNodeUs'][0]={'duration-bool':True,'fraction':1.5,'negative':-1,'overrange':90000001,'string':'SYNTHETIC_SECRET'}[name]
            values.append(v)
            with self.assertRaises((ValueError,TypeError,KeyError)):rtt.project_rtt_evidence(v)
        self.assertEqual(self.nodes(values),[{'ok':False}]*len(values));self.assertEqual(self.both([self.case(v) for v in values]),[{'ok':False}]*len(values))

    def test_failed_partial_evidence_is_preserved_without_zero_substitution_or_promotion(self):
        evidence={'schema':1,'directNodeUs':[1000,None,2000],'proxyNodeUs':[39001,47999],'browserProxyUs':[],'unknown':[1,0,0]}
        projected=self.both([self.case(evidence)])[0]['value'];self.assertEqual(projected['rttEvidence'],evidence);self.assertIsNone(projected['rttEvidence']['directNodeUs'][1]);self.assertFalse(projected['passed']);self.assertFalse(projected['acceptance']);self.assertEqual(projected['status'],'failed')

    def test_missing_required_rtt_fails_atomically_and_other_schema_stays_unchanged(self):
        value=self.case(maximum_rtt_evidence());value.pop('rttEvidence');self.assertEqual(self.both([value]),[{'ok':False}])
        plain={'schema':'r116-frozen-browser-v1','status':'failed'};private={**plain,'rttEvidence':{'private':'SYNTHETIC_SECRET'}}
        self.assertEqual(self.both([plain,private])[0],self.both([plain,private])[1])

    def test_source_worst_case31763_and_final_exit_frame32013_remain_below_cap(self):
        value=actual_near_maximum_case();value.update(status='failed',r111Operation='initial-validation',r111ErrorName='AssertionError',r111ErrorCode='ERR_IPC_CHANNEL_CLOSED',r111ErrorStackSha256='d'*64,r111ChildStdoutSha256='a'*64,r111ChildStderrSha256='a'*64,r111SourceModule='docs/research/codex-cloud-assets/r111/candidate/harness/server.mjs');value['metrics'].update(r111ChildStdoutBytes=10**12,r111ChildStderrBytes=10**12,r111SourceLine=58,r111SourceColumn=100000)
        self.assertEqual(len((compact_json(value)+'\n').encode()),31763);projected=self.both([value])[0]['value'];self.assertEqual(projected['rttEvidence'],value['rttEvidence']);self.assertEqual(len((compact_json(projected)+'\n').encode()),31763)
        envelope={'schema':'docker-hard-2cpu-6g-result-v1','passed':True,'control':'none','intentionalNegative':False,'samples':10000,'cgroupMemoryPeak':6442450944,'rssUnknownSamples':10000,'pssUnknownSamples':10000,'orphanReaped':True,'caseResult':projected}
        self.assertEqual(len((compact_json(envelope)+'\n').encode()),31996);projected['caseExitCode']=0;self.assertEqual(len((compact_json(envelope)+'\n').encode()),32013);self.assertLess(len((compact_json(envelope)+'\n').encode()),32768)

if __name__=='__main__':unittest.main()
