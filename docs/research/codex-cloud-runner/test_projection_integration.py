"""Exercise both actual sanitizer bodies without importing a runtime entrypoint."""
import copy
import json
from pathlib import Path
import shutil
import subprocess
import unittest
import docker_envelope as host
from test_r111_vector_policy import actual_near_maximum_case, compact_json, complete_vectors

HERE = Path(__file__).resolve().parent
NODE_SCRIPT = r"""
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const root=process.argv[1],policy=JSON.parse(fs.readFileSync(root+'/result-policy.json','utf8'));
const {projectNumericEvidence,assertCaseBudget}=await import(pathToFileURL(root+'/r111_vectors.mjs'));
const source=fs.readFileSync(root+'/inside.mjs','utf8');
const start=source.indexOf('function sanitized(value) {'),end=source.indexOf('\nfunction boundedCaseResult(',start);
if(start<0||end<0)throw Error('pure sanitizer extraction failed');
const ensure=(ok)=>{if(!ok)throw Error('invalid');};
const sanitize=new Function('publicPolicy','projectNumericEvidence','assertCaseBudget','ensure',source.slice(start,end)+';return sanitized;')(policy,projectNumericEvidence,assertCaseBudget,ensure);
let text='';for await(const bytes of process.stdin)text+=bytes;
process.stdout.write(JSON.stringify(JSON.parse(text).map(value=>{try{return{ok:true,value:sanitize(value)};}catch{return{ok:false};}})));
"""

class BothProjectionControls(unittest.TestCase):
    def both(self, values):
        node = shutil.which("node")
        self.assertTrue(node)
        proc = subprocess.run([node,"--max-old-space-size=128","--input-type=module","-e",NODE_SCRIPT,str(HERE)],input=compact_json(values),text=True,capture_output=True,timeout=8)
        self.assertEqual(proc.returncode,0,"pure sanitizer failed; raw output omitted")
        self.assertLess(len(proc.stdout.encode()),512*1024)
        js = json.loads(proc.stdout)
        py = []
        for value in values:
            try: py.append({"ok":True,"value":host.sanitized_result(value)})
            except (ValueError,TypeError,host.Blocked): py.append({"ok":False})
        # Historical host behavior adds empty scope/metrics when absent; retain that behavior.
        # R111 has both containers and must match exactly, including all vectors and nulls.
        def legacy_empty_containers(row):
            result=copy.deepcopy(row)
            if result.get("ok") and result["value"].get("schema") != "r111-long-session-v2":
                for key in ("scope","metrics"):
                    if result["value"].get(key) == {}:result["value"].pop(key,None)
            return result
        self.assertEqual([legacy_empty_containers(x) for x in js],[legacy_empty_containers(x) for x in py])
        return js
    def test_r111_both_actual_branches_preserve_all_maximum_vectors(self):
        value=actual_near_maximum_case(); projected=self.both([value])[0]
        self.assertTrue(projected["ok"])
        for key in ("sampleVectors","journeyLatencies"):self.assertEqual(projected["value"][key],value[key])
        self.assertEqual(len((compact_json(projected["value"])+"\n").encode()),30716)
    def test_r111_case_exit_and_actual_envelope_remain_below_frame_cap(self):
        case=self.both([actual_near_maximum_case()])[0]["value"];case["caseExitCode"]=0
        envelope={"schema":"docker-hard-2cpu-6g-result-v1","passed":True,"control":"none","intentionalNegative":False,"samples":10000,"cgroupMemoryPeak":6442450944,"rssUnknownSamples":10000,"pssUnknownSamples":10000,"orphanReaped":True,"caseResult":case}
        self.assertEqual(len((compact_json(envelope)+"\n").encode()),30966)
        self.assertLess(len((compact_json(envelope)+"\n").encode()),32768)
    def test_r111_failed_partial_evidence_survives_without_becoming_accepted(self):
        value=actual_near_maximum_case();value.update(status="failed",code="r111-child-nonzero")
        value.update(complete_vectors());value["journeyLatencies"]["rows"]=value["journeyLatencies"]["rows"][:3];value["journeyLatencies"]["unknown"]=[0,0,3,0]
        result=self.both([value])[0]["value"]
        self.assertFalse(result["passed"]);self.assertFalse(result["acceptance"]);self.assertEqual(len(result["journeyLatencies"]["rows"]),3)
    def test_r111_missing_or_private_or_malformed_vectors_fail_atomically(self):
        values=[]
        for mutation in ("missing","private","wrong-schema","bad-null-count"):
            value=actual_near_maximum_case()
            if mutation=="missing":value.pop("sampleVectors")
            elif mutation=="private":value["sampleVectors"]["privateURL"]="SYNTHETIC_SECRET"
            elif mutation=="wrong-schema":value["journeyLatencies"]["schema"]=0
            else:value["sampleVectors"]["unknown"][0]=1
            values.append(value)
        self.assertEqual(self.both(values),[{"ok":False}]*4)
    def test_r111_oversize_or_promoted_full_acceptance_fails(self):
        values=[]
        for mutation in ("oversize","passed","acceptance","mode"):
            value=actual_near_maximum_case()
            if mutation=="oversize":value["private"]="x"*32768
            elif mutation=="mode":value["mode"]="wrong"
            else:value[mutation]=True
            values.append(value)
        self.assertEqual(self.both(values),[{"ok":False}]*4)
    def test_old_schema_projection_ignores_new_vectors_and_private_objects(self):
        plain={"schema":"r116-frozen-browser-v1","status":"blocked","passed":False}
        value={**plain,"sampleVectors":{"private":"SYNTHETIC_SECRET"},"journeyLatencies":{"private":"SYNTHETIC_SECRET"}}
        output=self.both([plain,value])
        self.assertEqual(output[0],output[1]);self.assertNotIn("SYNTHETIC",compact_json(output))
    def test_r116_closed_diagnostics_nullable_counts_and_callback_survive(self):
        failure={"failureOperation":"reference-navigation","errorName":"type-error","errorCode":"ENOENT","errorStackSha256":"a"*64}
        value={"schema":"r116-frozen-browser-v1","status":"failed",**failure,"callbackFailure":{**failure,"errorStackSha256":None},"diagnosticMetrics":{"surveyStatus":"observed","documentReadyState":"interactive","tasksTabCount":1,"tasksTabVisibleCount":0,"possibleSummaryCount":None,"pageErrorCount":2}}
        result=self.both([value])[0]["value"]
        for key in failure:self.assertEqual(result[key],value[key])
        self.assertEqual(result["callbackFailure"],value["callbackFailure"]);self.assertEqual(result["diagnosticMetrics"],value["diagnosticMetrics"])
    def test_r116_unknown_error_strings_nested_private_fields_and_bad_counts_drop(self):
        value={"schema":"r116-frozen-browser-v1","status":"failed","failureOperation":"SYNTHETIC_SECRET","errorName":"SYNTHETIC_SECRET","errorCode":"SYNTHETIC_SECRET","errorStackSha256":"SYNTHETIC_SECRET","callbackFailure":{"failureOperation":"reference-navigation","message":"SYNTHETIC_SECRET","url":"SYNTHETIC_SECRET"},"diagnosticMetrics":{"surveyStatus":"unavailable","tasksTabCount":True,"pageErrorCount":-1,"possibleSummaryCount":None,"private":"SYNTHETIC_SECRET"}}
        result=self.both([value])[0]["value"]
        self.assertNotIn("SYNTHETIC",compact_json(result));self.assertNotIn("tasksTabCount",result["diagnosticMetrics"]);self.assertIsNone(result["diagnosticMetrics"]["possibleSummaryCount"])
    def test_r116_diagnostic_objects_are_not_admitted_for_other_schemas(self):
        result=self.both([{"schema":"r130-codec-functional-v1","status":"failed","callbackFailure":{"failureOperation":"reference-navigation"},"diagnosticMetrics":{"surveyStatus":"observed"}}])[0]["value"]
        self.assertNotIn("callbackFailure",result);self.assertNotIn("diagnosticMetrics",result)
    def test_r125_diagnostic_flags_hashes_and_known_errors_survive_both(self):
        value={"schema":"r125-focus-functional-v1","status":"failed","focusOperation":"source-lock","focusErrorName":"Error","focusErrorCode":"source-lock-mismatch","focusErrorStackSha256":"b"*64,"focusBrowserVersionOutputSha256":"c"*64,"focusSourceTreeAdmitted":True,"focusSourceLockAdmitted":False,"metrics":{"focusSourceFileCount":1934,"focusSourceLockFileCount":1934,"focusPatchedFileCount":0},"private":"SYNTHETIC_SECRET"}
        result=self.both([value])[0]["value"]
        for key in ("focusOperation","focusErrorName","focusErrorCode","focusErrorStackSha256","focusBrowserVersionOutputSha256","focusSourceTreeAdmitted","focusSourceLockAdmitted","metrics"):self.assertEqual(result[key],value[key])
        self.assertNotIn("SYNTHETIC",compact_json(result))

if __name__ == "__main__":
    unittest.main()
