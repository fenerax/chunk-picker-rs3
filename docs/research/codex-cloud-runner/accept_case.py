#!/usr/bin/env python3
"""Host-only acceptance of an already saved public envelope result."""
import json
import os
from pathlib import Path
import stat
import sys

SCHEMAS = {"r124": "r124-engine-api-comparison-v1", "r130": "r130-codec-functional-v1"}

def accepted(value, case):
    if case not in SCHEMAS or not isinstance(value, dict):
        return False
    if value.get("passed") is not True or value.get("cleanupPassed") is not True:
        return False
    result = value.get("result")
    actual = result.get("caseResult") if isinstance(result, dict) else None
    if not isinstance(actual, dict) or actual.get("schema") != SCHEMAS[case] or actual.get("status") != "correct" or actual.get("passed") is not True:
        return False
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
