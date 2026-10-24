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

if __name__ == "__main__":
    unittest.main()
