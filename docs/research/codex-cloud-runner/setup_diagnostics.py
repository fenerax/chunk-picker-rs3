#!/usr/bin/env python3
"""Print bounded fixed-template diagnostics; never print original output or substrings."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

STAGES = {"dependency-setup", "public-image-pull", "pure-controls"}
MAX_LOG = 16 * 1024**2
TAIL_BYTES = 64 * 1024

def line_class(line, stage):
    s = line.lower()
    if stage == "pure-controls":
        if "filenotfounderror" in s:
            return "pure-controls-input-missing"
        if "modulenotfounderror" in s or "importerror" in s:
            return "pure-controls-import-failed"
        if "assertionerror" in s:
            return "pure-controls-assertion-failed"
        if "syntaxerror" in s:
            return "pure-controls-syntax-failed"
    if "double-loading config" in s:
        return "npm-config-source-duplicate"
    if "eintegrity" in s or "integrity checksum failed" in s:
        return "npm-integrity-mismatch"
    if "npm ci can only install" in s or "missing: " in s and "from lock file" in s or "invalid: " in s and "lock file" in s:
        return "npm-lock-mismatch"
    if "no matching manifest" in s or "does not match the specified platform" in s:
        return "platform-unavailable"
    if "cannot connect to the docker daemon" in s or "is the docker daemon running" in s:
        return "docker-daemon-unavailable"
    if "docker daemon socket" in s and "permission denied" in s:
        return "docker-daemon-permission-denied"
    if "manifest unknown" in s or "manifest for " in s and "not found" in s:
        return "image-manifest-missing"
    if "digest" in s and ("did not match" in s or "mismatch" in s):
        return "image-digest-mismatch"
    if "no space left on device" in s or "enospc" in s:
        return "no-space"
    if "eacces" in s or "permission denied" in s:
        return "permission-denied"
    if any(x in s for x in ("eai_again", "enotfound", "temporary failure in name resolution", "no such host")):
        return "dns-failure"
    if any(x in s for x in ("etimedout", "connection timed out", "tls handshake timeout")):
        return "connection-timeout"
    if "econnreset" in s or "econnrefused" in s:
        return "connection-failure"
    if any(x in s for x in ("self signed certificate", "unable to verify", "certificate has expired", "cert_has_expired", "unable_to_get_issuer_cert")):
        return "tls-verification-failed"
    if any(x in s for x in ("toomanyrequests", "too many requests", "rate limit", "e429")):
        return "image-rate-limited" if stage == "public-image-pull" else "registry-rate-limited"
    if any(x in s for x in ("unauthorized", "authentication required", "e401", "e403", "access denied", "requested access to the resource is denied")):
        return "image-auth-denied" if stage == "public-image-pull" else "registry-auth-denied"
    if any(x in s for x in ("e500", "e502", "e503", "e504", "service unavailable", "bad gateway")):
        return "registry-unavailable"
    return "unclassified-output-omitted"

def summarize_tail(data, stage):
    classes = []
    for line in data[-TAIL_BYTES:].decode("utf-8", "replace").splitlines()[-64:]:
        item = line_class(line, stage)
        if item not in classes:
            classes.append(item)
    primary = next((x for x in classes if x != "unclassified-output-omitted"), "unknown-setup-error")
    return primary, classes[-8:]

def pure_test_ids(data):
    # Emit only complete IDs from the reviewed static source policy, never regex captures.
    try:
        policy = json.loads(Path(__file__).with_name("result-policy.json").read_text())
        known = policy["pureTestIds"]
        lines = data[-TAIL_BYTES:].decode("utf-8", "replace").splitlines()[-64:]
        return [item for item in known if isinstance(item, str) and item.startswith("test_") and any(line.startswith("ERROR: " + item + " (") or line.startswith("FAIL: " + item + " (") for line in lines)][:8]
    except (OSError, ValueError, KeyError, TypeError):
        return []

def diagnose(stage, exit_code, filename):
    if stage not in STAGES or type(exit_code) is not int or not 0 <= exit_code <= 255:
        raise ValueError()
    fd = os.open(filename, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_BINARY", 0))
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_LOG:
            raise ValueError()
        digest, tail, total = hashlib.sha256(), b"", 0
        while True:
            block = os.read(fd, 64 * 1024)
            if not block:
                break
            total += len(block)
            if total > MAX_LOG:
                raise ValueError()
            digest.update(block)
            tail = (tail + block)[-TAIL_BYTES:]
    finally:
        os.close(fd)
    primary, normalized = summarize_tail(tail, stage)
    result = {"schema": "public-setup-diagnostic-v1", "stage": stage, "passed": False,
            "exitCode": exit_code, "errorClass": primary, "logBytes": total,
            "logSha256": digest.hexdigest(), "normalizedTail": normalized,
            "tailTruncated": total > TAIL_BYTES}
    if stage == "pure-controls":
        result["failedTestIds"] = pure_test_ids(tail)
    return result

class Parser(argparse.ArgumentParser):
    def error(self, _message):
        raise ValueError()

def main(argv=None):
    stage = None
    try:
        p = Parser(description=__doc__)
        p.add_argument("--stage", required=True, choices=sorted(STAGES))
        p.add_argument("--exit-code", required=True, type=int)
        p.add_argument("--log", required=True)
        args = p.parse_args(argv)
        stage = args.stage
        result = diagnose(stage, args.exit_code, args.log)
    except (OSError, ValueError, TypeError):
        result = {"schema": "public-setup-diagnostic-v1", "stage": stage if stage in STAGES else "setup",
                  "passed": False, "errorClass": "diagnostic-unavailable"}
    print(json.dumps(result, sort_keys=True))
    return 0

if __name__ == "__main__":
    sys.exit(main())
