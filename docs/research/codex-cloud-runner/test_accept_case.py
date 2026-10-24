import copy
import unittest
from accept_case import accepted

def valid(case):
    row = {"schema": "r124-engine-api-comparison-v1" if case == "r124" else "r130-codec-functional-v1", "status": "correct", "passed": True}
    if case == "r124":
        row["metrics"] = {"r124BaselineCompletedCases": 8, "r124CandidateCompletedCases": 8}
    else:
        row.update(processStatus="correct", threadStatus="correct")
    return {"passed": True, "cleanupPassed": True, "result": {"caseResult": row}}

class HostAcceptanceControls(unittest.TestCase):
    def test_accept_positive_both_cases_without_mode(self):
        for case in ("r124", "r130"):
            self.assertTrue(accepted(valid(case), case))
    def test_accept_failed_case_rejected_despite_green_envelope(self):
        for case in ("r124", "r130"):
            row = valid(case); row["result"]["caseResult"].update(status="failed", passed=False)
            self.assertFalse(accepted(row, case))
    def test_accept_missing_case_rejected(self):
        for value in ({}, {"passed":True,"cleanupPassed":True}, {"passed":True,"cleanupPassed":True,"result":{}}, None):
            self.assertFalse(accepted(value,"r124"))
    def test_accept_wrong_schema_rejected(self):
        for case in ("r124", "r130"):
            row = valid(case); row["result"]["caseResult"]["schema"] = "wrong"
            self.assertFalse(accepted(row, case))
    def test_accept_outer_or_cleanup_failure_rejected(self):
        for case in ("r124", "r130"):
            for key in ("passed", "cleanupPassed"):
                row = valid(case); row[key] = False
                self.assertFalse(accepted(row, case))
    def test_accept_r124_requires_both_exact_eight_counts(self):
        for key in ("r124BaselineCompletedCases", "r124CandidateCompletedCases"):
            for bad in (7, None, "8", True, 8.0):
                row = valid("r124"); row["result"]["caseResult"]["metrics"][key] = bad
                self.assertFalse(accepted(row, "r124"))
    def test_accept_r130_requires_both_backend_statuses(self):
        for key in ("processStatus", "threadStatus"):
            for bad in ("failed", "unrun", None):
                row = valid("r130"); row["result"]["caseResult"][key] = bad
                self.assertFalse(accepted(row, "r130"))
    def test_accept_r116_requires_both_projections_calibration_and_cleanup(self):
        case={"schema":"r116-frozen-browser-v1","mode":"r116-frozen-input-v1","status":"correct","openingStatus":"correct","frozenStatus":"correct","rttStatus":"within-band","cleanupStatus":"complete","caseExitCode":0}
        final={"passed":True,"cleanupPassed":True,"result":{"caseResult":case}}
        self.assertTrue(accepted(final,"r116"))
        for key,bad in (("openingStatus","blocked"),("frozenStatus","incorrect"),("rttStatus","outside-band"),("cleanupStatus","incomplete"),("caseExitCode",False),("status","failed"),("passed",False)):
            changed=copy.deepcopy(final);changed["result"]["caseResult"][key]=bad;self.assertFalse(accepted(changed,"r116"))
    def test_accept_r131_requires_all_ten_intents_both_modes_and_real_proof_counts(self):
        case={"schema":"r131-borrow-native-v1","status":"correct","passed":True,"code":"r131-native-correct","cleanupPassed":True,"nativeAssertionsPassed":True,"sourceCommit":"6f22fefa782747790e2eaefa01e4e5ea7b557323","r131NativeReportSha256":"a"*64,"r131RuntimeManifestSha256":"d5de71c73a26b5667b7a99b31e08d297f37fee1935f6bdb1142fb0ba545f695c","r131CandidatePatchSha256":"f338823b045747b9e0a052bcb04d4db632b83eb5400a370a9b7ff3637a8c4ee1","metrics":{"r131CompletedIntentCount":10,"r131ModeCount":2,"r131DeclarationProofCount":2,"r131TaskProofCount":2,"r131IndependentFallbackCount":8}}
        final={"passed":True,"cleanupPassed":True,"result":{"caseResult":case}}
        self.assertTrue(accepted(final,"r131"))
        for key in case["metrics"]:
            changed=copy.deepcopy(final);changed["result"]["caseResult"]["metrics"][key]=0;self.assertFalse(accepted(changed,"r131"))
        for key in ("r131NativeReportSha256","r131RuntimeManifestSha256","r131CandidatePatchSha256"):
            changed=copy.deepcopy(final);changed["result"]["caseResult"].pop(key);self.assertFalse(accepted(changed,"r131"))

if __name__ == "__main__":
    unittest.main()
