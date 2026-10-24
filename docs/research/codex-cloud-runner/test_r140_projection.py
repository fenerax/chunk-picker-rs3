"""R140 uses strict existing vector algorithms in both actual sanitizer bodies."""
import copy
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import unittest

import docker_envelope as host
import test_projection_integration as projection
from test_r111_vector_policy import actual_near_maximum_case, compact_json, empty_vectors
from test_r140_host import valid_final

HERE = Path(__file__).resolve().parent


def case_fixture():
    return valid_final()[0]["result"]["caseResult"]


def source_worst_case():
    # Exact field/length recipe from immutable R140 diagnostic.test.mjs.
    value = json.loads(compact_json(actual_near_maximum_case()).replace("r111", "r140"))
    value.update(schema="r140-unshaped-session-v1", mode="r140-public-duo-unshaped-v1", profile="UNSHAPED_0_ADDED_LATENCY", observerMode="CURRENT_SYNC_CHECKPOINTS", allFinalGates="OPEN", status="failed", code="r140-unshaped-source-slice-observed", r140HealthStatus="invalid-observation", r140HealthVersionSha256="a" * 64, r140Operation="initial-validation", r140ErrorName="AssertionError", r140ErrorCode="ERR_IPC_CHANNEL_CLOSED", r140ErrorStackSha256="d" * 64, r140ChildStdoutSha256="a" * 64, r140ChildStderrSha256="a" * 64, r140SourceModule="docs/research/codex-cloud-assets/r140/candidate/harness/server.mjs")
    value["metrics"].update(artificialDelayMs=0, r140HealthInitialCount=40, r140HealthInitialValid=40, r140HealthFinalCount=10, r140HealthFinalValid=10, r140HealthFailureStatus=599, r140ChildStdoutBytes=10**12, r140ChildStderrBytes=10**12, r140SourceLine=58, r140SourceColumn=100000)
    return value


def new_blocks(raw, filename):
    if filename.endswith(".py"):
        start = b'    if value.get("schema") == "r140-unshaped-session-v1":\n'
        first_end = b'    if value.get("schema") == "r111-long-session-v2":\n'
        last_end = b'    return out\n'
    else:
        start = b"  if (value?.schema === 'r140-unshaped-session-v1') {\n"
        first_end = b"  if (value?.schema === 'r111-long-session-v2') {\n"
        last_end = b'  return out;\n'
    first = raw.index(start); end = raw.index(first_end, first)
    last = raw.index(start, end); finish = raw.index(last_end, last)
    return raw[first:end], raw[last:finish]


class R140ProjectionControls(unittest.TestCase):
    both = projection.BothProjectionControls.both

    def test_exact_host_copies_and_removal_of_only_new_blocks_reconstructs_entire_base(self):
        receipt = json.loads((HERE / "r140-projection-source-receipt.json").read_bytes())
        for row in receipt["exactHostCopies"]:
            raw = (HERE / row["path"]).read_bytes()
            self.assertEqual(len(raw), row["bytes"])
            self.assertEqual(hashlib.sha256(raw).hexdigest(), row["sourceSha256"])
        for row in receipt["adapterByteProof"]:
            raw = (HERE / row["path"]).read_bytes()
            blocks = new_blocks(raw, row["path"])
            self.assertEqual(len(blocks), 2)
            for block, expected in zip(blocks, row["insertions"]):
                self.assertEqual(hashlib.sha256(block).hexdigest(), expected["sha256"])
                self.assertEqual(len(block), expected["bytes"])
                self.assertEqual(raw.count(block), 1)
                raw = raw.replace(block, b"", 1)
            self.assertEqual(hashlib.sha256(raw).hexdigest(), row["baseWholeFileSha256"])
            self.assertEqual(len(raw), row["baseWholeFileBytes"])
        original = (HERE / "r111_rtt_policy.py").read_bytes()
        self.assertEqual((HERE / "r140_rtt_policy.py").read_bytes().replace(b"r140", b"r111"), original)

    def test_complete_vectors_and_all_rtt_values_survive_both_actual_branches(self):
        value = case_fixture(); result = self.both([value])[0]
        self.assertTrue(result["ok"])
        for key in ("sampleVectors", "journeyLatencies", "rttEvidence"):
            self.assertEqual(result["value"][key], value[key])
        self.assertEqual(result["value"]["profile"], "UNSHAPED_0_ADDED_LATENCY")
        self.assertFalse(result["value"]["passed"]); self.assertFalse(result["value"]["acceptance"])

    def test_valid_partial_failed_arrays_nulls_unknowns_and_drop_counts_are_preserved(self):
        value = case_fixture(); value.update(empty_vectors(), status="failed", code="r140-child-nonzero", cleanupPassed=False)
        value["sampleVectors"]["dropped"] = 2
        value["journeyLatencies"].update(rows=[[0, 0, 0, None, 10, None, 20]], unknown=[1, 0, 1, 0], dropped=3)
        value["rttEvidence"] = {"schema": 1, "directNodeUs": [1000, None], "proxyNodeUs": [90000000], "browserProxyUs": [], "unknown": [1, 0, 0]}
        result = self.both([value])[0]["value"]
        for key in ("sampleVectors", "journeyLatencies", "rttEvidence"):
            self.assertEqual(result[key], value[key])
        self.assertIsNone(result["rttEvidence"]["directNodeUs"][1])
        self.assertFalse(result["passed"]); self.assertEqual(result["status"], "failed")

    def test_missing_malformed_private_or_overlong_structures_fail_atomically(self):
        values = []
        for change in ("missing-samples", "missing-journeys", "missing-rtt", "private-samples", "private-rtt", "schema-bool", "rtt-bool", "rtt-fraction", "rtt-range", "rtt-unknown", "rtt-long", "journey-bool", "extra-row", "sample-count"):
            value = case_fixture()
            if change.startswith("missing-"): value.pop({"missing-samples": "sampleVectors", "missing-journeys": "journeyLatencies", "missing-rtt": "rttEvidence"}[change])
            elif change == "private-samples": value["sampleVectors"]["url"] = "SYNTHETIC_SECRET"
            elif change == "private-rtt": value["rttEvidence"]["url"] = "SYNTHETIC_SECRET"
            elif change == "schema-bool": value["rttEvidence"]["schema"] = True
            elif change == "rtt-bool": value["rttEvidence"]["directNodeUs"][0] = True
            elif change == "rtt-fraction": value["rttEvidence"]["directNodeUs"][0] = 1.5
            elif change == "rtt-range": value["rttEvidence"]["directNodeUs"][0] = 90000001
            elif change == "rtt-unknown": value["rttEvidence"]["unknown"][0] = 1
            elif change == "rtt-long": value["rttEvidence"]["directNodeUs"].append(1)
            elif change == "journey-bool": value["journeyLatencies"]["rows"][0][0] = True
            elif change == "extra-row": value["journeyLatencies"]["rows"][0].append(0)
            else: value["sampleVectors"]["unknown"][0] = 0
            values.append(value)
        self.assertEqual(self.both(values), [{"ok": False}] * len(values))

    def test_profile_mode_acceptance_and_raw_budget_invariants_fail_before_projection(self):
        values = []
        for key, bad in (("mode", "r111-public-duo-session-v2"), ("profile", "LEGACY_BROAD_SCOPE"), ("profile", None), ("observerMode", "ASYNC_WRITER"), ("allFinalGates", "CLOSED"), ("passed", True), ("acceptance", True), ("status", "correct")):
            value = case_fixture(); value[key] = bad; values.append(value)
        for bad in (True, False, 20, None, "0"):
            value = case_fixture(); value["metrics"]["artificialDelayMs"] = bad; values.append(value)
        value = case_fixture(); value["private"] = "x" * 32768; values.append(value)
        self.assertEqual(self.both(values), [{"ok": False}] * len(values))

    def test_exact_new_policy_markers_are_required_in_both_bodies(self):
        value = case_fixture()
        for marker in ("r140NumericVectors", "r140RttEvidence"):
            for bad in (None, {}, {**host.POLICY[marker], "unknown": True}):
                with self.subTest(marker=marker, bad=bad):
                    policy = copy.deepcopy(host.POLICY); policy[marker] = bad
                    original = host.POLICY
                    try:
                        host.POLICY = policy
                        with self.assertRaises(host.Blocked): host.sanitized_result(value)
                    finally: host.POLICY = original
                    # Only replace the policy binding in the existing extraction
                    # harness; its actual sanitizer body is still unmodified.
                    replacement = "policy[" + json.dumps(marker) + "]=" + compact_json(bad) + ";let text='';"
                    script = projection.NODE_SCRIPT.replace("let text='';", replacement)
                    proc = subprocess.run([shutil.which("node"), "--max-old-space-size=128", "--input-type=module", "-e", script, str(HERE)], input=compact_json([value]), text=True, capture_output=True, timeout=8)
                    self.assertEqual(proc.returncode, 0, "pure policy-marker control failed; raw output omitted")
                    self.assertEqual(json.loads(proc.stdout), [{"ok": False}])

    def test_source_worst_case_and_actual_exit_zero_frame_have_345_bytes_spare(self):
        value = source_worst_case()
        self.assertEqual(len((compact_json(value) + "\n").encode()), 32173)
        projected = self.both([value])[0]["value"]
        self.assertEqual(projected, value)
        envelope = {"schema": "docker-hard-2cpu-6g-result-v1", "passed": True, "control": "none", "intentionalNegative": False, "samples": 10000, "cgroupMemoryPeak": 6442450944, "rssUnknownSamples": 10000, "pssUnknownSamples": 10000, "orphanReaped": True, "caseResult": projected}
        self.assertEqual(len((compact_json(envelope) + "\n").encode()), 32406)
        projected["caseExitCode"] = 0
        frame_bytes = len((compact_json(envelope) + "\n").encode())
        self.assertEqual(frame_bytes, 32423)
        self.assertEqual(32768 - frame_bytes, 345)

    def test_existing_r111_branch_remains_independent_and_other_schemas_drop_r140_vectors(self):
        old = actual_near_maximum_case()
        result = self.both([old])[0]["value"]
        for key in ("sampleVectors", "journeyLatencies", "rttEvidence"):
            self.assertEqual(result[key], old[key])
        plain = {"schema": "r116-frozen-browser-v1", "status": "failed"}
        injected = {**plain, "sampleVectors": {"private": "SYNTHETIC_SECRET"}, "rttEvidence": {"private": "SYNTHETIC_SECRET"}}
        rows = self.both([plain, injected]); self.assertEqual(rows[0], rows[1])


if __name__ == "__main__": unittest.main()
