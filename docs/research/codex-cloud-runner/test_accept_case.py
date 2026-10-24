import copy
import unittest
from accept_case import accepted

def valid_r131():
    case={"schema":"r131-borrow-native-v1","status":"correct","passed":True,"code":"r131-native-correct","cleanupPassed":True,"nativeAssertionsPassed":True,"sourceCommit":"6f22fefa782747790e2eaefa01e4e5ea7b557323","r131NativeReportSha256":"a"*64,"r131RuntimeManifestSha256":"ab7dad55b8896826c8ca1502c9ac30de8c924dc0b24d0cddff7e0f1bc36be1b5","r131CandidatePatchSha256":"f338823b045747b9e0a052bcb04d4db632b83eb5400a370a9b7ff3637a8c4ee1",
          "r131NativeCellSha256":"8db8127ef5659cb0df6451dbe0ddb7e33419625d065df33b67be17491b9a4f4e","r131NativeCellUrlSha256":"9377ac871d388c3c15322cdba0781779f79fb6194dfc86d2e4abe398939b104b","r131FixtureModuleSha256":"45475f2b3d930c345f7afc22e93ad61d8585bbe53b7f0f099a46933329d9768e","r131FixtureModuleUrlSha256":"8843aae1765843b07b47d1084d00f2e45a10baf4fa25ab9cc1fb8da963af4555","r131NativeCellRelativeModule":"native-cell-v3.mjs","r131FixtureRelativeModule":"scheduler-fixture-v3.mjs","r131ModuleRootStatus":"matched",
          "metrics":{"r131CompletedIntentCount":10,"r131ModeCount":2,"r131DeclarationProofCount":2,"r131TaskProofCount":2,"r131IndependentFallbackCount":8,"r131NativeModuleProofCount":2}}
    return {"passed":True,"cleanupPassed":True,"result":{"caseResult":case}}

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
        case={"schema":"r116-frozen-browser-v1","mode":"r116-frozen-input-v1","status":"correct","openingStatus":"correct","frozenStatus":"correct","rttStatus":"within-band","cleanupStatus":"complete","caseExitCode":0,"harnessManifestSha256":"e47f0130064f361d242a1b3d7724e103e57835eb530883246ebe78a738b6c91e"}
        final={"passed":True,"cleanupPassed":True,"result":{"caseResult":case}}
        self.assertTrue(accepted(final,"r116"))
        for key,bad in (("harnessManifestSha256","0"*64),("openingStatus","blocked"),("frozenStatus","incorrect"),("rttStatus","outside-band"),("cleanupStatus","incomplete"),("caseExitCode",False),("status","failed"),("passed",False)):
            changed=copy.deepcopy(final);changed["result"]["caseResult"][key]=bad;self.assertFalse(accepted(changed,"r116"))
    def test_accept_r131_requires_all_ten_intents_both_modes_and_real_proof_counts(self):
        final=valid_r131();case=final["result"]["caseResult"]
        self.assertTrue(accepted(final,"r131"))
        for key in case["metrics"]:
            changed=copy.deepcopy(final);changed["result"]["caseResult"]["metrics"][key]=0;self.assertFalse(accepted(changed,"r131"))
        for key in ("r131NativeReportSha256","r131RuntimeManifestSha256","r131CandidatePatchSha256"):
            changed=copy.deepcopy(final);changed["result"]["caseResult"].pop(key);self.assertFalse(accepted(changed,"r131"))
    def test_accept_r131_requires_both_exact_module_bytes_and_mapped_url_hashes(self):
        for key in ("r131NativeCellSha256","r131NativeCellUrlSha256","r131FixtureModuleSha256","r131FixtureModuleUrlSha256"):
            for bad in (None,"0"*64,"a"*40,True,[],{}):
                changed=valid_r131();changed["result"]["caseResult"][key]=bad
                self.assertFalse(accepted(changed,"r131"),key)
            changed=valid_r131();changed["result"]["caseResult"].pop(key)
            self.assertFalse(accepted(changed,"r131"),key)
    def test_accept_r131_requires_known_relative_modules_and_matched_root(self):
        for key in ("r131NativeCellRelativeModule","r131FixtureRelativeModule","r131ModuleRootStatus"):
            for bad in (None,"unobserved","file:///scratch/SYNTHETIC_SECRET","../native-cell-v3.mjs",True):
                changed=valid_r131();changed["result"]["caseResult"][key]=bad
                self.assertFalse(accepted(changed,"r131"),key)
            changed=valid_r131();changed["result"]["caseResult"].pop(key)
            self.assertFalse(accepted(changed,"r131"),key)
    def test_accept_r131_proof_count_is_two_distinct_modules_not_four_ipc_events(self):
        for bad in (None,0,1,3,4,2.0,True,"2"):
            changed=valid_r131();changed["result"]["caseResult"]["metrics"]["r131NativeModuleProofCount"]=bad
            self.assertFalse(accepted(changed,"r131"))
        changed=valid_r131();changed["result"]["caseResult"]["metrics"].pop("r131NativeModuleProofCount")
        self.assertFalse(accepted(changed,"r131"))
    def test_accept_r131_rejects_old_manifest_or_failed_case_with_proofs(self):
        for key,bad in (("r131RuntimeManifestSha256","d70a4b35ba631b863c10b98b7b2b9faa2871aa2eaee914f694c90d71807d2a70"),("status","failed"),("passed",False),("nativeAssertionsPassed",False),("cleanupPassed",False)):
            changed=valid_r131();changed["result"]["caseResult"][key]=bad
            self.assertFalse(accepted(changed,"r131"))

if __name__ == "__main__":
    unittest.main()
