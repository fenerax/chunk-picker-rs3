#!/usr/bin/env python3
"""One Docker-owned public/synthetic experiment. Import and --plan have no side effects."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import time
import uuid

HERE = Path(__file__).resolve().parent
PINS = json.loads((HERE / "pins.json").read_text())
POLICY = json.loads((HERE / "result-policy.json").read_text())
LABEL = "rs3.public-experiment.owner"
ACK = "remote-disposable-public"
HEX64 = re.compile(r"^[0-9a-f]{64}$")

class Blocked(RuntimeError):
    pass

def require(ok, code):
    if not ok:
        raise Blocked(code)

def sha(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()

def parse_cpus(text):
    out = set()
    for item in text.strip().split(","):
        if not item:
            continue
        require(bool(re.fullmatch(r"\d+(?:-\d+)?", item)), "invalid-cpu-list")
        pair = item.split("-")
        lo, hi = int(pair[0]), int(pair[-1])
        require(0 <= lo <= hi <= 65535, "invalid-cpu-range")
        out.update(range(lo, hi + 1))
    return out

def safe_relative(value):
    p = PurePosixPath(value)
    require(not p.is_absolute() and bool(p.parts) and all(x not in {"..", ".", ".git", ".env"} for x in p.parts), "unsafe-entrypoint")
    require(re.fullmatch(r"[A-Za-z0-9_./-]+\.mjs", value) is not None, "unsafe-entrypoint")
    return value

def profile(control):
    return {"cpus": 0.25 if control == "cpu" else 2,
            "memory": 128 * 1024**2 if control == "memory" else PINS["memoryBytes"],
            "pids": 512, "init": control != "missing-init"}

def fixed_env():
    return {"HOME": "/scratch/home", "TMPDIR": "/scratch/tmp", "PATH": "/runtime:/usr/bin:/bin",
            "PLAYWRIGHT_BROWSERS_PATH": "/ms-playwright", "NODE_PATH": "/deps/node_modules",
            "PERF_SOURCE_ROOT": "/source", "PERF_HARNESS_ROOT": "/harness", "PERF_OUTPUT_ROOT": "/scratch",
            "PERF_CASE_RESULT": "/scratch/case-result.json", "PERF_STAGE_FD": "3"}

def expected_config_env():
    # Exact defaults from the digest-verified public OCI image config; no host environment read.
    inherited = dict(item.split("=", 1) for item in PINS["imageEnv"])
    return {**inherited, **fixed_env()}

def create_args(args, owner, cpus, uid, gid):
    p = profile(args.control)
    mounts = [(args.source, "/source", True), (args.harness, "/harness", True),
              (args.deps, "/deps", True), (args.node, "/runtime/node", True),
              (HERE, "/runner", True), (Path(args.output) / "scratch", "/scratch", False)]
    cmd = ["create", "--cidfile", str(Path(args.output).resolve() / "container.cid"), "--platform", PINS["platform"], "--pull=never", "--label", f"{LABEL}={owner}",
           "--label", f"rs3.public-experiment.envelope={PINS['envelope']}", "--cpus", str(p["cpus"]),
           "--cpuset-cpus", ",".join(map(str, cpus)), "--memory", str(p["memory"]),
           "--memory-swap", str(p["memory"]), "--pids-limit", "512", "--network", "none",
           "--ipc", "private", "--cgroupns", "private",
           "--shm-size", "268435456", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
           "--read-only", "--user", f"{uid}:{gid}", "--workdir", "/scratch", "--stop-timeout", "10",
           "--log-driver", "none", "--entrypoint", "/usr/bin/timeout"]
    if p["init"]:
        cmd.append("--init")
    for source, target, ro in mounts:
        source = str(Path(source).resolve())
        require("," not in source and "\n" not in source, "unsafe-mount-path")
        cmd += ["--mount", f"type=bind,src={source},dst={target}" + (",readonly" if ro else "")]
    # All values are explicit; no host variable names or env files are forwarded.
    for key, value in fixed_env().items():
        cmd += ["--env", f"{key}={value}"]
    # Independent image-provided watchdog, so a blocked Node event loop cannot extend the case.
    cmd += [PINS["image"], "--signal=TERM", "--kill-after=3s", str(max(1, args.seconds - 20)) + "s",
            "/runtime/node", "/runner/inside.mjs", "--control", args.control, "--mode", args.mode,
            "--seconds", str(args.seconds), "--cpus", ",".join(map(str, cpus)), "--uid", str(uid),
            "--entrypoint", safe_relative(args.entrypoint)]
    for value in args.arg:
        require("\0" not in value and len(value) <= 4096, "unsafe-case-argument")
        cmd += ["--arg", value]
    return cmd

def mount_sources(args):
    return {"/source": str(args.source.resolve()), "/harness": str(args.harness.resolve()),
            "/deps": str(args.deps.resolve()), "/runtime/node": str(args.node.resolve()),
            "/runner": str(HERE), "/scratch": str((args.output / "scratch").resolve())}

def hostconfig_errors(doc, owner, cpus, p, uid, sources):
    h, c = doc.get("HostConfig", {}), doc.get("Config", {})
    actual_env, expected_env = c.get("Env"), expected_config_env()
    checks = {
        "owner-label": c.get("Labels", {}).get(LABEL) == owner,
        "image-pin": c.get("Image") == PINS["image"],
        "image-content": doc.get("Image") == PINS["imageConfigDigest"],
        "cpu-bandwidth": h.get("NanoCpus") == int(p["cpus"] * 1e9),
        "cpu-affinity": parse_cpus(h.get("CpusetCpus", "")) == set(cpus),
        "memory-cap": h.get("Memory") == p["memory"],
        "no-swap": h.get("MemorySwap") == p["memory"],
        "pids-cap": h.get("PidsLimit") == 512,
        "init": h.get("Init") is True,
        "network-none": h.get("NetworkMode") == "none",
        "readonly-root": h.get("ReadonlyRootfs") is True,
        "no-privilege": h.get("Privileged") is False and not h.get("CapAdd") and "ALL" in h.get("CapDrop", []),
        "no-new-privileges": h.get("SecurityOpt") == ["no-new-privileges"],
        "explicit-environment": isinstance(actual_env, list) and all(isinstance(x, str) for x in actual_env) and len(actual_env) == len(expected_env) and set(actual_env) == {f"{k}={v}" for k, v in expected_env.items()},
        # Docker's exact supported default encoding for private PID and UTS is empty, not "private".
        "private-namespaces": h.get("PidMode") == "" and h.get("IpcMode") == "private" and h.get("UTSMode") == "" and h.get("CgroupnsMode") == "private",
        "nonroot": c.get("User", "").split(":")[0] == str(uid) and uid != 0,
        "no-ports": not h.get("PortBindings") and not h.get("PublishAllPorts"),
        "no-devices": not h.get("Devices") and not h.get("DeviceRequests"),
    }
    m = {x.get("Destination"): x for x in doc.get("Mounts", [])}
    expected = {"/source": False, "/harness": False, "/deps": False, "/runtime/node": False, "/runner": False, "/scratch": True}
    checks["exact-mounts"] = len(doc.get("Mounts", [])) == len(expected) and set(m) == set(expected) and all(m[k].get("RW") is v and m[k].get("Type") == "bind" and m[k].get("Source") == sources[k] for k, v in expected.items())
    return [key for key, ok in checks.items() if not ok]

def sanitized_result(value):
    require(isinstance(value, dict), "case-result-not-object")
    out = {k: v for k, v in value.items() if k in POLICY["scalarKeys"] and (type(v) is bool or type(v) in {int, float} and -1e15 < v < 1e15)}
    for key, allowed in POLICY["enums"].items():
        if isinstance(value.get(key), str) and value[key] in allowed:
            out[key] = value[key]
    for key in POLICY["hashKeys"]:
        item = value.get(key)
        if isinstance(item, str) and re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", item):
            out[key] = item
    scope = value.get("scope", {})
    if isinstance(scope, dict):
        out["scope"] = {k: v for k, v in scope.items() if k in POLICY["scope"] and type(v) in {str, int, bool} and v in POLICY["scope"][k] and not (k == "group" and type(v) is not bool)}
    metrics = value.get("metrics", {})
    if isinstance(metrics, dict):
        # Keys are fixed metric identifiers, never user-controlled labels or URLs.
        metric_keys = POLICY["metricKeys"]
        out["metrics"] = {k: v for k, v in metrics.items() if k in metric_keys and type(v) in {int, float} and -1e15 < v < 1e15}
    gates = POLICY["openGates"]
    if isinstance(value.get("openGates"), list):
        out["openGates"] = [x for x in value["openGates"] if isinstance(x, str) and x in gates]
    return out

def bounded_bytes(path, limit=32768):
    # Child-writable scratch must never redirect reads to another file/device via a link.
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_size <= limit, "unsafe-result-file")
        data = os.read(fd, limit + 1)
        require(len(data) <= limit, "result-file-too-large")
        return data
    finally:
        os.close(fd)

def bounded_json(path, limit=32768):
    return json.loads(bounded_bytes(path, limit))

def recover_cid(cid, cidfile):
    if isinstance(cid, str) and HEX64.fullmatch(cid):
        return cid
    if Path(cidfile).exists():
        recovered = bounded_bytes(cidfile, 66).decode().strip()
        if HEX64.fullmatch(recovered):
            return recovered
    return None

def journal_evidence(path):
    """Only numeric cgroup facts and fixed stage/CPU values can reach public JSON."""
    if not Path(path).exists():
        return {"present": False}
    data = bounded_bytes(path, 16 * 1024**2)
    out = {"present": True, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "samples": 0, "caseStages": []}
    allowed_metrics = {"memoryCurrent", "memoryPeak", "memorySwapCurrent", "pidsCurrent"}
    groups = {"memoryEvents": {"low", "high", "max", "oom", "oom_kill", "oom_group_kill"},
              "cpuStat": {"usage_usec", "user_usec", "system_usec", "nr_periods", "nr_throttled", "throttled_usec", "nr_bursts", "burst_usec"},
              "pidsEvents": {"max"}}
    def numbers(value, keys):
        return {k: v for k, v in value.items() if k in keys and type(v) is int and 0 <= v <= 10**18} if isinstance(value, dict) else {}
    for line in data.splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            out["partialOrInvalidLine"] = True
            continue
        if not isinstance(row, dict):
            continue
        stage = row.get("stage")
        if not isinstance(stage, str):
            continue
        if stage == "cgroup-admission":
            admission = {}
            for key in ("cpuMax", "memoryMax", "memorySwapMax", "pidsMax"):
                v = row.get(key)
                if isinstance(v, str) and re.fullmatch(r"\d+(?: \d+)?", v):
                    admission[key] = [int(x) for x in v.split()] if key == "cpuMax" else int(v)
            for key in ("cpuset", "affinity"):
                v = row.get(key)
                if isinstance(v, str) and re.fullmatch(r"\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*", v):
                    parsed = sorted(parse_cpus(v))
                    if len(parsed) <= 2:
                        admission[key] = parsed
            if isinstance(row.get("initComm"), str) and row["initComm"] in {"docker-init", "tini", "catatonit"}:
                admission["initComm"] = row["initComm"]
            out["admission"] = admission
        if stage == "case-stage" and row.get("caseStage") in POLICY["stages"] and len(out["caseStages"]) < 128:
            out["caseStages"].append(row["caseStage"])
        if stage in {"resource-before", "resource-sample", "resource-final", "cpu-control-after", "memory-control-after"}:
            sample = numbers(row, allowed_metrics)
            for key, keys in groups.items():
                sample[key] = numbers(row.get(key), keys)
            sample["processMemory"] = numbers(row.get("proc"), {"processes", "tasks", "zombieLeaders", "sampledRssKiB", "sampledPssKiB", "rssUnknown", "pssUnknown", "races"})
            out.setdefault("first", sample)
            out["last"] = sample
            out["samples"] += 1
        if stage == "memory-control-child-exit" and row.get("childSignal") == "SIGKILL" and row.get("childExitCode") is None and type(row.get("deltaOomKill")) is int and 0 < row["deltaOomKill"] < 10000:
            out["controlEvidence"] = {"childSignal": "SIGKILL", "childExitCode": None, "deltaOomKill": row["deltaOomKill"]}
    out["processMemoryScope"] = "sampled-container-process-leaders-rss-shared-pages-double-counted-pss-readable-subset"
    return out

def envelope_projection(doc, control):
    require(isinstance(doc, dict) and doc.get("schema") == "docker-hard-2cpu-6g-result-v1" and doc.get("passed") is True, "inside-envelope-failed")
    require(doc.get("control") == control, "inside-control-mismatch")
    out = {"passed": True, "control": control}
    for key in ("samples", "cgroupMemoryPeak", "rssUnknownSamples", "pssUnknownSamples"):
        value = doc.get(key)
        require(type(value) is int and 0 <= value <= 10**12, "invalid-inside-metric")
        out[key] = value
    for key in ("intentionalNegative", "orphanReaped"):
        require(type(doc.get(key)) is bool, "invalid-inside-status")
        out[key] = doc[key]
    out["caseResult"] = sanitized_result(doc.get("caseResult", {}))
    return out

def container_exit_allowed(state, control):
    # A child-only OOM may set Docker's aggregate flag while init/supervisor survives.
    # Memory-control success still requires the separately validated inner child/cgroup proof.
    return state.get("ExitCode") == 0 and (control == "memory" or not state.get("OOMKilled"))

def audit_deps(root):
    root = Path(root)
    require(not root.is_symlink() and root.is_dir(), "unsafe-dependency-root")
    resolved = root.resolve()
    require(set(p.name for p in root.iterdir()) == {"package.json", "package-lock.json", "node_modules"}, "unexpected-dependency-root-file")
    for item in root.rglob("*"):
        require(not any(x == ".git" or x == ".env" or x.startswith(".env.") for x in item.relative_to(root).parts), "credential-bearing-dependency-name")
        if item.is_symlink():
            require(resolved in item.resolve().parents and item.resolve().is_file(), "escaping-dependency-symlink")
        else:
            require(item.is_dir() or item.is_file(), "special-dependency-file")

def tree_manifest(root):
    root = Path(root).resolve()
    require(root.is_dir(), "input-tree-missing")
    result = {}
    for path in sorted(root.rglob("*")):
        require(not path.is_symlink(), "symlink-in-input")
        if path.is_file():
            rel = path.relative_to(root).as_posix()
            require(not any(x == ".git" or x == ".env" or x.startswith(".env.") for x in Path(rel).parts), "credential-bearing-input-name")
            result[rel] = sha(path)
    require(bool(result), "input-tree-empty")
    return result

def verify_receipt(root, expected_commit):
    root = Path(root).resolve()
    receipt = root.with_name(root.name + ".receipt.json")
    doc = json.loads(receipt.read_text())
    require(doc.get("schema") == "public-git-archive-v1" and doc.get("commit") == expected_commit, "public-source-receipt-mismatch")
    actual = tree_manifest(root)
    require(doc.get("files") == actual, "public-tree-content-mismatch")
    return hashlib.sha256(json.dumps(actual, sort_keys=True, separators=(",", ":")).encode()).hexdigest()

DOCKER_TEMPLATES = {
    "create": "docker create --cidfile <owned-file> --platform linux/amd64 --pull=never --label <fixed-owner-labels> --cpus <profile> --cpuset-cpus <two-allowed> --memory <profile> --memory-swap <equal-memory> --pids-limit 512 --network none --ipc private --cgroupns private --shm-size 268435456 --cap-drop ALL --security-opt no-new-privileges --read-only --user <nonroot> --workdir /scratch --stop-timeout 10 --log-driver none --entrypoint /usr/bin/timeout [--init] --mount <six-exact-owned-mounts> --env <fixed-environment> <pinned-image> <bounded-entrypoint>",
    "inspect": "docker inspect --type container <exact-owned-id>",
    "start": "docker start <exact-owned-id>",
    "stop": "docker stop --time 5 <exact-owned-id>",
    "kill": "docker kill <exact-owned-id>",
    "wait": "docker wait <exact-owned-id>",
    "rm": "docker rm <exact-owned-id>",
}

def docker_error_class(stderr, timed_out=False):
    if timed_out:
        return "docker-command-timeout"
    text = stderr[-65536:].decode("utf-8", "replace").lower()
    if any(x in text for x in ("invalid pid mode", "invalid pidmode", "invalid --pid")):
        return "invalid-pid-mode"
    if any(x in text for x in ("invalid uts mode", "invalid utsmode", "uts mode can be", "invalid --uts")):
        return "invalid-uts-mode"
    if "permission denied" in text or "operation not permitted" in text:
        return "docker-permission-denied"
    if "cannot connect to the docker daemon" in text or "is the docker daemon running" in text:
        return "docker-daemon-unavailable"
    if "no such image" in text or "pull access denied" in text:
        return "docker-image-unavailable"
    if "no such container" in text:
        return "docker-container-not-found"
    if "invalid mount config" in text or "bind source path does not exist" in text:
        return "docker-invalid-mount"
    if "unknown flag" in text or "invalid argument" in text or "invalid parameter" in text:
        return "docker-invalid-argument"
    return "unknown-docker-error"

def docker_diagnostic(argv, exit_code, stdout=b"", stderr=b"", timed_out=False, required=True):
    verb = argv[0] if argv and argv[0] in DOCKER_TEMPLATES else "unknown"
    return {"schema": "docker-command-diagnostic-v1", "commandStage": "docker-" + verb,
            "argvTemplate": DOCKER_TEMPLATES.get(verb, "docker <unclassified-command>"),
            "exitCode": exit_code, "timedOut": timed_out, "requiredCommand": required,
            "errorClass": docker_error_class(stderr, timed_out), "outputComplete": not timed_out,
            "stdoutBytes": len(stdout), "stdoutSha256": hashlib.sha256(stdout).hexdigest(),
            "stderrBytes": len(stderr), "stderrSha256": hashlib.sha256(stderr).hexdigest()}

class Docker:
    def __init__(self, config, emit=None):
        binary = shutil.which("docker")
        require(bool(binary), "docker-client-unavailable")
        self.base = [binary, "--host", "unix:///var/run/docker.sock", "--config", str(config)]
        self.env = {"PATH": os.defpath, "LANG": "C.UTF-8", "HOME": str(config)}
        self.diagnostics = []
        self.emit = emit

    def record_failure(self, argv, exit_code, stdout, stderr, timed_out=False, required=True):
        record = docker_diagnostic(argv, exit_code, stdout or b"", stderr or b"", timed_out, required)
        self.diagnostics = (self.diagnostics + [record])[-8:]
        if self.emit:
            try:
                self.emit("docker-command-failed", {"diagnostic": record})
            except (OSError, ValueError):
                pass  # A failed log write cannot preempt exact-owned termination/cleanup.

    def call(self, argv, timeout=20, check=True, diagnose=True):
        try:
            proc = subprocess.run(self.base + list(argv), env=self.env, capture_output=True, timeout=timeout)
        except subprocess.TimeoutExpired as exc:
            self.record_failure(argv, None, exc.stdout, exc.stderr, timed_out=True, required=check)
            raise Blocked("docker-command-timeout") from None
        except OSError:
            self.record_failure(argv, None, b"", b"", required=check)
            raise Blocked("docker-client-exec-failed") from None
        if proc.returncode != 0 and diagnose:
            self.record_failure(argv, proc.returncode, proc.stdout, proc.stderr, required=check)
        require(len(proc.stdout) < 4 * 1024**2, "docker-output-too-large")
        if check:
            require(proc.returncode == 0, "docker-command-failed")
        return proc

    def inspect(self, cid):
        require(bool(HEX64.fullmatch(cid)), "invalid-owned-container-id")
        return json.loads(self.call(["inspect", "--type", "container", cid]).stdout)[0]

def owned_cleanup(docker, cid, owner, emit):
    # Never clean by name, prefix, ancestor, process group, --all, or --volumes.
    require(bool(HEX64.fullmatch(cid)), "invalid-owned-container-id")
    doc = docker.inspect(cid)
    require(doc.get("Id") == cid and doc.get("Config", {}).get("Labels", {}).get(LABEL) == owner, "cleanup-ownership-mismatch")
    if doc["State"]["Running"]:
        try:
            stopped = docker.call(["stop", "--time", "5", cid], timeout=8, check=False)
        except Blocked:
            stopped = None
        if stopped is None or stopped.returncode != 0 or docker.inspect(cid)["State"]["Running"]:
            # Recheck exact ID+label before the bounded forced termination fallback.
            check = docker.inspect(cid)
            require(check.get("Id") == cid and check.get("Config", {}).get("Labels", {}).get(LABEL) == owner, "cleanup-ownership-mismatch")
            try:
                docker.call(["kill", cid], timeout=5, check=False)
            except Blocked:
                pass  # A concurrent completed stop is judged by the fresh state below.
    final = docker.inspect(cid)
    require(final["State"]["Running"] is False and final["State"].get("Pid") == 0, "whole-container-still-running")
    if final["State"].get("Status") != "created":
        require(docker.call(["wait", cid], timeout=5).returncode == 0, "container-wait-failed")
    docker.call(["rm", cid])
    require(docker.call(["inspect", "--type", "container", cid], check=False, diagnose=False).returncode != 0, "container-removal-unconfirmed")
    # Logging failure must never prevent removal of the already-confirmed owned container.
    emit("container-exited", {"exitCode": final["State"].get("ExitCode"), "oomKilled": final["State"].get("OOMKilled"), "running": False, "pid": 0})
    emit("cleanup-finished", {"wholeContainerExited": True, "exactOwnedContainerRemoved": True})
    return final["State"]

def parser():
    p = argparse.ArgumentParser(description=__doc__)
    for key in ("source", "harness", "deps", "node", "output"):
        p.add_argument("--" + key, required=True, type=Path)
    p.add_argument("--harness-commit", required=True)
    p.add_argument("--entrypoint", default="one-case.mjs")
    p.add_argument("--arg", action="append", default=[])
    p.add_argument("--mode", choices=["component", "native", "browser", "soak"], default="component")
    p.add_argument("--control", choices=["none", "positive", "cpu", "memory", "missing-init"], default="none")
    p.add_argument("--seconds", type=int, default=120)
    p.add_argument("--execute", action="store_true")
    p.add_argument("--remote-only-ack")
    return p

def validate_args(a):
    require(1 <= a.seconds <= PINS["maxSeconds"], "duration-outside-envelope")
    require(a.mode != "soak" or a.seconds >= 1800, "soak-under-thirty-minutes")
    require(bool(re.fullmatch(r"[0-9a-f]{40}", a.harness_commit)), "invalid-harness-commit")
    safe_relative(a.entrypoint)
    if a.execute:
        require(a.seconds >= 25, "execution-budget-needs-termination-reserve")
        require(sys.platform == "linux" and os.uname().machine == "x86_64", "remote-linux-amd64-required")
        require(a.remote_only_ack == ACK, "remote-execution-ack-required")
        require(os.getuid() != 0, "nonroot-host-required")
    return a

def run(a):
    validate_args(a)
    if not a.execute:
        return {"schema": "docker-envelope-plan-v1", "envelope": PINS["envelope"], "preparedOnly": True,
                "runnerRevision": PINS["runnerRevision"],
                "mode": a.mode, "seconds": a.seconds, "control": a.control, "image": PINS["image"], "requiresRemoteExecution": True}
    # No executable, Docker or input files are touched by the plan path above.
    require(all(not x.is_symlink() for x in (a.source, a.harness, a.deps, a.node)), "symlink-input-root")
    source_sha = verify_receipt(a.source, PINS["sourceCommit"])
    harness_sha = verify_receipt(a.harness, a.harness_commit)
    require((a.harness / a.entrypoint).is_file() or a.control != "none", "case-entrypoint-missing")
    require(a.node.is_file() and not a.node.is_symlink(), "node-binary-missing-or-symlink")
    require((a.deps / "package-lock.json").is_file() and sha(a.deps / "package-lock.json") == sha(HERE / "package-lock.json"), "dependency-lock-mismatch")
    audit_deps(a.deps)
    runner_sha = hashlib.sha256(json.dumps(tree_manifest(HERE), sort_keys=True).encode()).hexdigest()
    require(json.loads((a.deps / "node_modules/playwright/package.json").read_text())["version"] == PINS["playwright"], "playwright-version-mismatch")
    inputs = [a.source.resolve(), a.harness.resolve(), a.deps.resolve(), a.node.resolve(), HERE]
    out = a.output.resolve()
    require(all(out != x and x not in out.parents and out not in x.parents for x in inputs), "output-overlaps-input")
    require(not out.exists(), "output-must-be-fresh")
    owner = uuid.uuid4().hex
    out.mkdir(parents=True, mode=0o700)
    (out / ".owner").write_text(owner)
    scratch = out / "scratch"
    scratch.mkdir(mode=0o700)
    for sub in ("home", "tmp"):
        (scratch / sub).mkdir(mode=0o700)
    config = out / "docker-config"
    config.mkdir(mode=0o700)
    events = (out / "host-stages.jsonl").open("a", encoding="utf-8")
    started = time.monotonic()
    def emit(stage, data=None):
        row = {"schema": "docker-envelope-event-v1", "stage": stage, "elapsedMs": round((time.monotonic() - started) * 1000, 3), **(data or {})}
        events.write(json.dumps(row, sort_keys=True, allow_nan=False) + "\n")
        events.flush()
        os.fsync(events.fileno())
    emit("inputs-verified", {"sourceManifestSha256": source_sha, "harnessManifestSha256": harness_sha, "runnerManifestSha256": runner_sha, "nodeSha256": sha(a.node), "dependencyLockSha256": sha(a.deps / "package-lock.json")})
    cpus = sorted(os.sched_getaffinity(0))[:2]
    require(len(cpus) == 2, "fewer-than-two-allowed-cpus")
    docker, cid, cleanup, result, failure, host_facts, cleanup_facts = None, None, False, None, None, None, None
    try:
        docker = Docker(config, emit)
        emit("container-create-start", {"cpus": cpus, "profile": profile(a.control), "control": a.control})
        cid = docker.call(create_args(a, owner, cpus, os.getuid(), os.getgid())).stdout.decode().strip()
        require(bool(HEX64.fullmatch(cid)), "invalid-created-container-id")
        doc = docker.inspect(cid)
        require(doc.get("Id") == cid, "created-container-id-mismatch")
        errors = hostconfig_errors(doc, owner, cpus, profile(a.control), os.getuid(), mount_sources(a))
        h = doc["HostConfig"]
        host_facts = {"containerId": cid, "imageId": doc.get("Image") if doc.get("Image") == PINS["imageConfigDigest"] else None,
                      "admitted": not errors, "failedChecks": errors, "nanoCpus": h.get("NanoCpus"), "cpus": cpus,
                      "memory": h.get("Memory"), "memorySwap": h.get("MemorySwap"), "pidsLimit": h.get("PidsLimit"), "init": h.get("Init") is True}
        emit("hostconfig-admission", {"containerId": cid, "imageId": doc.get("Image"), "passed": not errors, "failedChecks": errors, "profile": profile(a.control), "cpus": cpus})
        if a.control == "missing-init":
            require(errors == ["init"], "missing-init-control-unexpected-outcome")
            result = {"passed": True, "intentionalNegative": True, "reasonCode": "missing-init-rejected-before-start"}
        else:
            require(not errors, "hostconfig-admission-failed")
            # Reserve 15s for bounded stop/kill. The measured phase cannot consume the full ceiling.
            work_deadline = started + a.seconds - 15
            remaining = work_deadline - time.monotonic()
            require(remaining > 5, "admission-consumed-wall-budget")
            docker.call(["start", cid], timeout=min(20, remaining - 3))
            emit("container-started")
            deadline = work_deadline
            last_bytes = 0
            while True:
                journal = scratch / "envelope.jsonl"
                if journal.exists():
                    require(not journal.is_symlink(), "unsafe-probe-journal")
                    size = journal.stat().st_size
                    require(size <= 16 * 1024**2, "probe-journal-too-large")
                    if size != last_bytes:
                        last_bytes = size
                        emit("probe-progress", {"journalBytes": size})
                remaining = deadline - time.monotonic()
                require(remaining > 0, "container-wall-deadline")
                doc = json.loads(docker.call(["inspect", "--type", "container", cid], timeout=min(20, remaining)).stdout)[0]
                if not doc["State"]["Running"]:
                    break
                require(time.monotonic() < deadline, "container-wall-deadline")
                time.sleep(min(1, max(0, deadline - time.monotonic())))
            require(container_exit_allowed(doc["State"], a.control), "container-exit-failed")
            report_path = scratch / "envelope-result.json"
            require(report_path.is_file() and report_path.stat().st_size < 32768, "probe-final-result-missing")
            raw = bounded_json(report_path)
            # Projection is deliberately closed: raw child output/state/URLs never enter logs.
            result = envelope_projection(raw, a.control)
    except (Blocked, OSError, ValueError, KeyError) as exc:
        failure = str(exc) if isinstance(exc, Blocked) else "host-wrapper-error"
        emit("failed", {"reasonCode": failure})
    finally:
        try:
            cid = recover_cid(cid, out / "container.cid")
        except (Blocked, OSError, ValueError, UnicodeError):
            cid = None
            failure = failure or "owned-container-id-recovery-failed"
        if cid and HEX64.fullmatch(cid):
            try:
                cleanup_state = owned_cleanup(docker, cid, owner, emit)
                cleanup_facts = {"running": False, "pid": 0, "removed": True, "exitCode": cleanup_state.get("ExitCode"), "oomKilled": cleanup_state.get("OOMKilled") is True}
                cleanup = True
            except (Blocked, OSError, ValueError, KeyError):
                emit("cleanup-failed", {"reasonCode": "exact-owned-container-cleanup-unconfirmed"})
        try:
            evidence = journal_evidence(scratch / "envelope.jsonl")
        except (Blocked, OSError, ValueError):
            evidence = {"present": False, "unreadableOrUnsafe": True}
        final = {"schema": "docker-envelope-final-v1", "envelope": PINS["envelope"], "sourceCommit": PINS["sourceCommit"],
                 "runnerRevision": PINS["runnerRevision"], "dockerDiagnostics": docker.diagnostics if docker else [],
                 "mode": a.mode, "control": a.control, "passed": failure is None and cleanup and result is not None,
                 "cleanupPassed": cleanup, "reasonCode": failure, "result": result, "resourceEvidence": evidence,
                 "hostConfig": host_facts, "containerCleanup": cleanup_facts,
                 "provenance": {"sourceManifestSha256": source_sha, "harnessManifestSha256": harness_sha,
                                "runnerManifestSha256": runner_sha, "nodeSha256": sha(a.node), "dependencyLockSha256": sha(a.deps / "package-lock.json")},
                 "baseline": {k: PINS[k] for k in ("image", "node", "playwright", "chromium", "chromiumRevision", "platform")},
                 "allProductAcceptanceGates": "OPEN"}
        (out / "final.json").write_text(json.dumps(final, sort_keys=True, allow_nan=False) + "\n")
        emit("final-written", {"passed": final["passed"], "cleanupPassed": cleanup})
        events.close()
    return final

def main():
    try:
        result = run(parser().parse_args())
    except (Blocked, OSError, ValueError, KeyError) as exc:
        result = {"schema": "docker-envelope-final-v1", "passed": False, "reasonCode": str(exc) if isinstance(exc, Blocked) else "host-wrapper-error"}
    print(json.dumps(result, sort_keys=True, allow_nan=False))
    return 0 if result.get("preparedOnly") or result.get("passed") else 1

if __name__ == "__main__":
    sys.exit(main())
