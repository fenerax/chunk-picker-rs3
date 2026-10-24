"""Pure R140 host completion controls; all envelopes and samples are authored."""
import contextlib
import io
import unittest

import accept_unshaped_session as host
import test_scoped_session as legacy

HARNESS = "33f7343825a6dd67a077e1ed8fe94a1c4e4ccd7ceab54116fb204b19c3965584"


def valid_final():
    final, lock = legacy.valid_final()
    case = final["result"]["caseResult"]
    case.update(schema="r140-unshaped-session-v1", mode="r140-public-duo-unshaped-v1", code="r140-unshaped-source-slice-observed", profile="UNSHAPED_0_ADDED_LATENCY", observerMode="CURRENT_SYNC_CHECKPOINTS", allFinalGates="OPEN", harnessManifestSha256=HARNESS, r140HealthStatus="complete", r140HealthVersionSha256="e" * 64)
    case["metrics"].update(artificialDelayMs=0, r140HealthInitialCount=40, r140HealthInitialValid=40, r140HealthFinalCount=10, r140HealthFinalValid=10)
    # High observed raw RTT is allowed in this explicitly unshaped profile.
    case["rttEvidence"] = {"schema": 1, "directNodeUs": [12345] * 10, "proxyNodeUs": [67890] * 20, "browserProxyUs": [58765] * 10, "unknown": [0, 0, 0]}
    return final, lock


class R140HostControls(unittest.TestCase):
    def test_complete_scoped_observation_remains_blocked_with_all_acceptance_open(self):
        final, lock = valid_final()
        self.assertTrue(host.scoped_observed(final, lock, HARNESS))
        case = final["result"]["caseResult"]
        self.assertFalse(case["passed"]); self.assertFalse(case["acceptance"])
        self.assertEqual(case["allFinalGates"], "OPEN")

    def test_independent_schema_profile_observer_and_acceptance_are_required(self):
        for key, bad in (("schema", "r111-long-session-v2"), ("mode", "r111-public-duo-session-v2"), ("profile", "LEGACY_BROAD_SCOPE"), ("profile", None), ("observerMode", "ASYNC_WRITER"), ("allFinalGates", "COMPLETE"), ("passed", True), ("acceptance", True), ("cleanupPassed", False), ("status", "correct")):
            final, lock = valid_final(); final["result"]["caseResult"][key] = bad
            self.assertFalse(host.scoped_observed(final, lock, HARNESS), key)
        for bad in (True, False, 1, -1, None, "0"):
            final, lock = valid_final(); final["result"]["caseResult"]["metrics"]["artificialDelayMs"] = bad
            self.assertFalse(host.scoped_observed(final, lock, HARNESS))

    def test_all_fifty_health_responses_and_hash_are_required_without_failure_status(self):
        for key in ("r140HealthInitialCount", "r140HealthInitialValid", "r140HealthFinalCount", "r140HealthFinalValid"):
            for bad in (None, True, 0, "40"):
                final, lock = valid_final(); final["result"]["caseResult"]["metrics"][key] = bad
                self.assertFalse(host.scoped_observed(final, lock, HARNESS), key)
        for key, bad in (("r140HealthStatus", "partial"), ("r140HealthStatus", "http-status"), ("r140HealthVersionSha256", None), ("r140HealthVersionSha256", "a" * 40)):
            final, lock = valid_final(); final["result"]["caseResult"][key] = bad
            self.assertFalse(host.scoped_observed(final, lock, HARNESS), key)
        final, lock = valid_final(); final["result"]["caseResult"]["metrics"]["r140HealthFailureStatus"] = 200
        self.assertFalse(host.scoped_observed(final, lock, HARNESS))

    def test_all_forty_nonnull_rtt_values_required_but_partial_failure_evidence_is_not_success(self):
        for change in ("missing", "empty", "partial", "null", "unknown", "private"):
            final, lock = valid_final(); case = final["result"]["caseResult"]; evidence = case["rttEvidence"]
            if change == "missing": case.pop("rttEvidence")
            elif change == "empty": evidence.update(directNodeUs=[], proxyNodeUs=[], browserProxyUs=[])
            elif change == "partial": evidence["browserProxyUs"].pop()
            elif change == "null": evidence["proxyNodeUs"][0] = None; evidence["unknown"][1] = 1
            elif change == "unknown": evidence["unknown"][0] = 1
            else: evidence["private"] = "SYNTHETIC_SECRET"
            self.assertFalse(host.scoped_observed(final, lock, HARNESS), change)

    def test_existing_cadence_journey_duration_source_and_cleanup_checks_remain_required(self):
        for change in ("cadence", "journey", "duration", "source", "harness", "gate", "cleanup", "orphan"):
            final, lock = valid_final(); case = final["result"]["caseResult"]
            if change == "cadence": case.update(legacy.vectors([0, 1800000]))
            elif change == "journey": case["journeyLatencies"]["rows"][0][1] = 5
            elif change == "duration": case["metrics"]["timedDurationMs"] = 1799999
            elif change == "source": case["sourceManifestSha256"] = "0" * 64
            elif change == "harness": case["harnessManifestSha256"] = "0" * 64
            elif change == "gate": case["openGates"].pop()
            elif change == "cleanup": final["containerCleanup"]["removed"] = False
            else: final["result"]["orphanReaped"] = False
            self.assertFalse(host.scoped_observed(final, lock, HARNESS), change)

    def test_expected_harness_is_external_and_cli_failure_is_closed(self):
        final, lock = valid_final()
        for expected in (None, "", "a" * 64):
            self.assertFalse(host.scoped_observed(final, lock, expected))
        out = io.StringIO()
        with contextlib.redirect_stdout(out): self.assertEqual(host.main([]), 1)
        self.assertNotIn("SYNTHETIC", out.getvalue())
        self.assertIn('"fullAcceptance": false', out.getvalue())


if __name__ == "__main__": unittest.main()
