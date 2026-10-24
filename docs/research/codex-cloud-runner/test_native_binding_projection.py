"""Pure controls over the real R131 projection bodies and frozen source binding."""
import hashlib
import json
import shutil
import subprocess
import unittest

import docker_envelope as host
from accept_case import R131_BINDING, accepted
from test_accept_case import valid_r131
import test_projection_integration as projection
from test_r111_vector_policy import compact_json

PREFIX = "docs/research/codex-cloud-assets/r131-warm-error-v4/"
HERE, NODE_SCRIPT = projection.HERE, projection.NODE_SCRIPT
MODULE_FIELDS = {
    "native-cell-v3.mjs": ("r131NativeCellSha256", "r131NativeCellUrlSha256"),
    "scheduler-fixture-v3.mjs": ("r131FixtureModuleSha256", "r131FixtureModuleUrlSha256"),
}
ENUM_FACTS = {
    "r131ErrorModule": "scheduler-fixture-v3.mjs",
    "r131AssertOperator": "strictEqual",
    "r131AssertActualType": "number",
    "r131AssertExpectedType": "boolean",
    "r131NativeCellRelativeModule": "native-cell-v3.mjs",
    "r131FixtureRelativeModule": "scheduler-fixture-v3.mjs",
    "r131ModuleRootStatus": "matched",
}
NEW_METRICS = ("r131ErrorLine", "r131ErrorColumn", "r131AssertActual", "r131AssertExpected", "r131NativeModuleProofCount")


def case_fixture():
    value = valid_r131()["result"]["caseResult"]
    value.update(ENUM_FACTS)
    value["metrics"].update(r131ErrorLine=-1, r131ErrorColumn=-1, r131AssertActual=0.25, r131AssertExpected=1)
    return value


class NativeBindingProjectionControls(unittest.TestCase):
    both = projection.BothProjectionControls.both

    def test_pinned_manifest_and_all_fifteen_mapped_source_bytes(self):
        # Published canonical layout is authoritative; the source-only fallback is
        # the immutable owner's packet, never another sibling runner snapshot.
        runtime = HERE.parent / "codex-cloud-assets" / "r131-warm-error-v4"
        if not runtime.is_dir():
            runtime = HERE.parent.parent / "r131-warm-error-v4" / "runtime-publication"
        manifest_bytes = (runtime / "runtime-publication-manifest.json").read_bytes()
        self.assertEqual(hashlib.sha256(manifest_bytes).hexdigest(), R131_BINDING["r131RuntimeManifestSha256"])
        manifest = json.loads(manifest_bytes)
        self.assertEqual(manifest["schema"], "r131-required-runtime-assets-v1")
        self.assertEqual(manifest["entry"], "entry.mjs")
        self.assertEqual(len(manifest["files"]), 14)
        self.assertEqual(len({row["path"] for row in manifest["files"]}), 14)
        for row in manifest["files"]:
            raw = (runtime / row["path"]).read_bytes()
            self.assertEqual(len(raw), row["bytes"])
            self.assertEqual(hashlib.sha256(raw).hexdigest(), row["sha256"])
        for module, (byte_key, url_key) in MODULE_FIELDS.items():
            raw = (runtime / module).read_bytes()
            self.assertEqual(hashlib.sha256(raw).hexdigest(), R131_BINDING[byte_key])
            url = "file:///harness/" + PREFIX + module
            self.assertEqual(hashlib.sha256(url.encode("utf-8")).hexdigest(), R131_BINDING[url_key])

    def test_both_actual_projectors_preserve_successful_binding_and_finite_assertion_values(self):
        value = case_fixture()
        projected = self.both([value])[0]
        self.assertTrue(projected["ok"])
        result = projected["value"]
        for key, expected in R131_BINDING.items():
            self.assertEqual(result[key], expected)
        for key, expected in ENUM_FACTS.items():
            self.assertEqual(result[key], expected)
        for key in NEW_METRICS:
            self.assertEqual(result["metrics"][key], value["metrics"][key])
        self.assertTrue(accepted({"passed": True, "cleanupPassed": True, "result": {"caseResult": result}}, "r131"))
        self.assertLess(len((compact_json(result) + "\n").encode()), 32768)

    def test_corrupt_or_missing_module_proofs_never_become_accepted_after_projection(self):
        values = []
        for key in (*MODULE_FIELDS["native-cell-v3.mjs"], *MODULE_FIELDS["scheduler-fixture-v3.mjs"]):
            for bad in (None, "0" * 64, "a" * 40, "SYNTHETIC_SECRET"):
                value = case_fixture(); value[key] = bad; values.append(value)
            value = case_fixture(); value.pop(key); values.append(value)
        for bad in (None, 0, 1, 4, 2.5, True, "2"):
            value = case_fixture(); value["metrics"]["r131NativeModuleProofCount"] = bad; values.append(value)
        for row in self.both(values):
            self.assertTrue(row["ok"])
            self.assertFalse(accepted({"passed": True, "cleanupPassed": True, "result": {"caseResult": row["value"]}}, "r131"))

    def test_fixed_enums_drop_arbitrary_operators_modules_paths_and_strings(self):
        values = []
        for bad in ("SYNTHETIC_SECRET", "file:///scratch/SYNTHETIC_SECRET", "../scheduler-fixture-v3.mjs", True, 0, [], {}):
            value = case_fixture()
            for key in ENUM_FACTS:
                value[key] = bad
            value.update(privatePath="SYNTHETIC_SECRET", r131UnknownModule="SYNTHETIC_SECRET")
            value["metrics"]["privateLabel"] = "SYNTHETIC_SECRET"
            values.append(value)
        for row in self.both(values):
            result = row["value"]
            for key in ENUM_FACTS:
                self.assertNotIn(key, result)
            self.assertNotIn("SYNTHETIC", compact_json(result))

    def test_numeric_diagnostics_use_existing_finite_metric_projection(self):
        values = []
        accepted_values = (-1e9, -1, 0, 0.25, 1e9)
        rejected_values = (True, False, None, "1", [], {}, 1e15, -1e15, 1e308, -1e308)
        for number in (*accepted_values, *rejected_values):
            value = case_fixture()
            for key in NEW_METRICS:
                value["metrics"][key] = number
            values.append(value)
        for index, row in enumerate(self.both(values)):
            metrics = row["value"]["metrics"]
            for key in NEW_METRICS:
                if index < len(accepted_values):
                    self.assertEqual(metrics[key], accepted_values[index])
                else:
                    self.assertNotIn(key, metrics)

    def test_nonfinite_numbers_drop_in_both_extracted_real_bodies(self):
        # JSON cannot transport NaN/Infinity. Construct them after JSON parsing in
        # the existing extraction harness; the real sanitizer body is unchanged.
        values = [case_fixture() for _ in range(3)]
        needle = "try{return{ok:true,value:sanitize(value)};}"
        self.assertIn(needle, NODE_SCRIPT)
        script = NODE_SCRIPT.replace("JSON.parse(text).map(value=>", "JSON.parse(text).map((value,index)=>").replace(needle, "try{value.metrics.r131AssertActual=[NaN,Infinity,-Infinity][index];return{ok:true,value:sanitize(value)};}")
        proc = subprocess.run([shutil.which("node"), "--max-old-space-size=128", "--input-type=module", "-e", script, str(HERE)], input=compact_json(values), text=True, capture_output=True, timeout=8)
        self.assertEqual(proc.returncode, 0, "pure nonfinite sanitizer control failed; raw output omitted")
        js = json.loads(proc.stdout)
        for index, number in enumerate((float("nan"), float("inf"), -float("inf"))):
            values[index]["metrics"]["r131AssertActual"] = number
            py = host.sanitized_result(values[index])
            py.pop("scope", None)
            self.assertEqual(js[index], {"ok": True, "value": py})
            self.assertNotIn("r131AssertActual", py["metrics"])


if __name__ == "__main__":
    unittest.main()
