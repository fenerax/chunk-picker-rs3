#!/usr/bin/env python3
"""Accept only the declared R111 scoped observation; never full product acceptance."""
import hashlib
import json
import math
import re
import sys
from accept_case import read_final
from r111_vector_policy import project_numeric_evidence

PIN = "6f22fefa782747790e2eaefa01e4e5ea7b557323"
FIXTURE = "a672a1f9b5de6a699a18c26c5fad6fe477a5e37d05c75f115f425a8a3f789b09"
HARNESS = "2d6bbb25cac1673b296e03535b33cfd62e71187814974347e14b9cc561a2cc34"
SCOPE = {"dataset":"duo-legacy","fixtureBaseline":"r37-authored-711-v2","players":2,"overlays":1,"memberUnlockedChunks":1,"taskCoverage":"fixture-member-catalogue","sessionMinutes":30}
GATES = {"fault-recovery","latest-generation","physical-paint","independent-engine-correctness","full-legacy-coverage","memory-nonaccumulation","statistical-performance"}
BASELINE = {"node":"v24.19.0","playwright":"1.62.1","chromium":"151.0.7922.34","chromiumRevision":"1234","platform":"linux/amd64","image":"mcr.microsoft.com/playwright:v1.62.1-noble@sha256:c091b21d9fae78c76e85cd4356431e9b018402f172a214fc7d7a5e9a7e29d8ac"}

def check(ok):
    if not ok:
        raise ValueError("scoped-observation-incomplete")

def hex64(value):
    return type(value) is str and re.fullmatch(r"[0-9a-f]{64}", value) is not None

def number(value, low, high):
    return type(value) in (int,float) and math.isfinite(value) and low <= value <= high

def scoped_observed(final, source_lock):
    try:
        check(type(final) is dict and final.get("schema") == "docker-envelope-final-v1")
        check(final.get("envelope") == "docker-hard-2cpu-6g-v1" and final.get("mode") == "soak" and final.get("control") == "none" and final.get("sourceCommit") == PIN)
        check(final.get("passed") is True and final.get("cleanupPassed") is True and final.get("allProductAcceptanceGates") == "OPEN")
        cleanup = final.get("containerCleanup", {})
        check(cleanup.get("running") is False and cleanup.get("removed") is True and cleanup.get("oomKilled") is False)
        check(type(cleanup.get("pid")) is int and cleanup["pid"] == 0 and type(cleanup.get("exitCode")) is int and cleanup["exitCode"] == 0)
        check(all(final.get("baseline",{}).get(k) == v for k,v in BASELINE.items()))
        inner = final.get("result",{})
        check(inner.get("passed") is True and inner.get("control") == "none" and inner.get("intentionalNegative") is False and inner.get("orphanReaped") is True)
        case = inner.get("caseResult",{})
        check(case.get("schema") == "r111-long-session-v2" and case.get("mode") == "r111-public-duo-session-v2" and case.get("status") == "blocked" and case.get("code") == "r111-source-slice-observed")
        check(case.get("passed") is False and case.get("acceptance") is False and case.get("cleanupPassed") is True and type(case.get("caseExitCode")) is int and case["caseExitCode"] == 0)
        check(case.get("sourcePin") == PIN and case.get("fixtureSha256") == FIXTURE and case.get("harnessManifestSha256") == HARNESS)
        node = case.get("nodeSha256")
        check(hex64(node) and node == final.get("provenance",{}).get("nodeSha256"))
        check(type(source_lock) is dict and type(source_lock.get("schemaVersion")) is int and source_lock["schemaVersion"] == 1 and source_lock.get("sourceCommit") == PIN and source_lock.get("verification") == "host-verified-public-git-archive")
        files = source_lock.get("files")
        check(type(files) is list and len(files) > 0 and hex64(source_lock.get("manifestSha256")))
        digest = hashlib.sha256(json.dumps(files,separators=(",",":"),ensure_ascii=False,allow_nan=False).encode()).hexdigest()
        check(digest == source_lock["manifestSha256"] == case.get("sourceManifestSha256"))
        scope = case.get("scope",{})
        check(type(scope) is dict and set(scope) == set(SCOPE) and all(type(scope[k]) is type(v) and scope[k] == v for k,v in SCOPE.items()))
        check(type(case.get("openGates")) is list and GATES.issubset(case["openGates"]))
        metrics = case.get("metrics",{})
        for key,expected in {"targetDurationMs":1800000,"operations":54,"mutations":45,"closedPages":3,"networkPending":0}.items():
            check(type(metrics.get(key)) is int and metrics[key] == expected)
        check(number(metrics.get("timedDurationMs"),1800000,1810000) and number(metrics.get("observedTimedDurationMs"),1800000,1815000) and number(metrics.get("elapsedMs"),1800000,2000000))
        vectors = project_numeric_evidence(case.get("sampleVectors"),case.get("journeyLatencies"))
        samples, journeys = vectors["sampleVectors"],vectors["journeyLatencies"]
        times = samples["tMs"]
        check(samples["dropped"] == 0 and len(times) >= 110 and times[0] <= 15000 and times[-1] >= 1800000)
        check(len({t//15000 for t in times}) == len(times) and all(b-a <= 45000 for a,b in zip(times,times[1:])))
        check(journeys["dropped"] == 0 and len(journeys["rows"]) == 54 and all(row[:3] == [i,i%6,(i//6)%2] for i,row in enumerate(journeys["rows"])))
        return True
    except (ValueError,TypeError,KeyError,IndexError,AttributeError):
        return False

def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    passed = False
    try:
        if len(args) != 4 or args[0] != "--final" or args[2] != "--source-lock":
            raise ValueError()
        passed = scoped_observed(read_final(args[1]),read_final(args[3]))
    except (OSError,ValueError,TypeError):
        pass
    print(json.dumps({"schema":"r111-scoped-host-observation-v1","scopedObservationPassed":passed,"fullAcceptance":False,"allProductAcceptanceGates":"OPEN"}))
    return 0 if passed else 1

if __name__ == "__main__":
    sys.exit(main())
