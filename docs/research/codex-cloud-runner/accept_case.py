#!/usr/bin/env python3
"""Host-only acceptance of an already saved public envelope result."""
import json
import os
import re
from pathlib import Path
import stat
import sys

SCHEMAS = {"r124": "r124-engine-api-comparison-v1", "r130": "r130-codec-functional-v1", "r116": "r116-frozen-browser-v1", "r131": "r131-borrow-native-v1"}

def accepted(value, case):
    if case not in SCHEMAS or not isinstance(value, dict):
        return False
    if value.get("passed") is not True or value.get("cleanupPassed") is not True:
        return False
    result = value.get("result")
    actual = result.get("caseResult") if isinstance(result, dict) else None
    if not isinstance(actual, dict) or actual.get("schema") != SCHEMAS[case] or actual.get("status") != "correct":
        return False
    if case == "r116":
        return ("passed" not in actual or actual["passed"] is True) and actual.get("harnessManifestSha256") == "87ef6ee01fa4bfdbfd0ada62b4b3e55541ac67071b967c4181a8ff3e5b01f46f" and actual.get("mode") == "r116-frozen-input-v1" and actual.get("openingStatus") == "correct" and actual.get("frozenStatus") == "correct" and actual.get("rttStatus") == "within-band" and actual.get("cleanupStatus") == "complete" and type(actual.get("caseExitCode")) is int and actual["caseExitCode"] == 0
    if actual.get("passed") is not True:
        return False
    if case == "r131":
        metrics = actual.get("metrics",{})
        expected = {"r131CompletedIntentCount":10,"r131ModeCount":2,"r131DeclarationProofCount":2,"r131TaskProofCount":2,"r131IndependentFallbackCount":8}
        report = actual.get("r131NativeReportSha256")
        return type(metrics) is dict and actual.get("code") == "r131-native-correct" and actual.get("cleanupPassed") is True and actual.get("nativeAssertionsPassed") is True and actual.get("sourceCommit") == "6f22fefa782747790e2eaefa01e4e5ea7b557323" and all(type(metrics.get(k)) is int and metrics[k] == v for k,v in expected.items()) and actual.get("r131RuntimeManifestSha256") == "fc3f39f0bb4765ec7074907fc69e8d25401d844e69d6377803cc74a0a342e8c4" and actual.get("r131CandidatePatchSha256") == "f338823b045747b9e0a052bcb04d4db632b83eb5400a370a9b7ff3637a8c4ee1" and type(report) is str and re.fullmatch(r"[0-9a-f]{64}",report) is not None
    if case == "r124":
        metrics = actual.get("metrics")
        return isinstance(metrics, dict) and all(type(metrics.get(key)) is int and metrics[key] == 8 for key in ("r124BaselineCompletedCases", "r124CandidateCompletedCases"))
    return actual.get("processStatus") == "correct" and actual.get("threadStatus") == "correct"

def read_final(filename):
    fd = os.open(filename, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_BINARY", 0))
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > 1048576:
            raise ValueError()
        raw = os.read(fd, 1048577)
        if len(raw) > 1048576:
            raise ValueError()
        return json.loads(raw)
    finally:
        os.close(fd)

def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    case, passed = None, False
    try:
        if len(args) != 4 or args[0] != "--case" or args[2] != "--final" or args[1] not in SCHEMAS:
            raise ValueError()
        case = args[1]
        passed = accepted(read_final(Path(args[3])), case)
    except (OSError, ValueError, TypeError):
        pass
    print(json.dumps({"schema": "public-host-case-acceptance-v1", "case": case, "casePassed": passed}))
    return 0 if passed else 1

if __name__ == "__main__":
    sys.exit(main())
