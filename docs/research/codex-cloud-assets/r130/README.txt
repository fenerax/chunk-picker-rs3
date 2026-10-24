R130 derived Docker source packet. RUNTIME UNRUN.

Recovered immutable transport: 23,860 bytes, 15 files, 8 separate JSON records;
SHA256 fce9b8f7c756edee764d2207c2db968bd6f66f9d73e66b56de9eae005fc2cfdd.
Exact original R114 driver remains f0030bb006397b0078853af20cd326b3819315a3092b35abaddb1757391cce32.
Its portable driver differs only in the explicitly published admission substitution.
All native functional assertions, helper/preload/fixture bytes and R49 patch remain unchanged.

Publish only the manifest-listed candidate files under docs/research/codex-cloud-assets/r130/.
Mount FULL public Git tree at /harness. entry.mjs and manifest paths resolve relative to import.meta.url.
The original packet is retained separately; it must not replace the derived packet.

Root wrapper fixed environment supplies PERF_SOURCE_ROOT=/source, PERF_HARNESS_ROOT=/harness,
PERF_OUTPUT_ROOT=/scratch, PERF_CASE_RESULT=/scratch/case-result.json, PERF_STAGE_FD=3,
NODE_PATH=/deps/node_modules. Entry validates that known NODE_PATH before clearing child inheritance,
then sets the child-only R130 admission marker. The marker is not an independent envelope proof.
Root entry writes fs.writeSync(3) JSON lines to RAW FD3, never process.send.
Nested driver fork receives its OWN Node IPC fd3 and removes PERF_STAGE_FD.

Node target v24.19.0 at /runtime/node; dependencies preinstalled at /deps/node_modules.
Immutable PUBLIC source pin 6f22fefa782747790e2eaefa01e4e5ea7b557323 at /source.
Root creates /scratch/source-lock.json. Source lock pin and exact core hashes checked;
R49 3,734-byte patch is applied ONLY to owned /scratch/r130/C using a pure strict Node
unified patch reader with exact context/counts/paths and pre/post expected SHA256 checks.
No git, Python, patch executable, network, or installation is needed inside the container.

Execute only after independent root Docker controls PASS: hard 2CPU, hard 6GiB/no swap,
pids512, init/nonroot/networknone/strict caps/read-only source. Outer120s, entry90s plus
termination reserve, each product35s (TERM; KILL after2s), child heap768MiB.
C/process/0/authored runs first. C/thread/1/authored runs only after first native assertions,
relay exits/PID absence, two app close/store/binding drains pass. No retry/fixture expansion.

The exact source driver preserves two app lifetimes and fresh wakes, lexical immutable
constructor/decoder/READY generations, process V8 exclusive bytes vs custom thread object
contract, selected dataset digest/tags/descriptors/Map/Set/canonical JSON/retained parent
input hashes/input deletion/retiring0/store removal/binding cleanup.
Authored fixture is 2 chunks / 2 Quest tasks, not a full94 legacy fixture.

Closed /scratch/case-result.json <=32KiB: status correct/failed, passed/cleanupPassed,
cell statuses, finite numeric metrics and declared hashes; process exit remains separate.
Full reports /scratch/r130-case-report.json and /scratch/r130-cell-{1,2}.log remain
ephemeral. They can contain generated store paths and runtime input details: never publish.
No catch block claims successful cleanup on forced termination.
result-policy.additions.json is a proposal ONLY; root owns policy merge and execution.

History stays: R104 C/thread0 PASS; R114 UNRUN/missing parent; R118 native incomplete,
guard ProcessLookupError; relay1806 zombie under PID1, complete drain unproved.
NO more apps on native09. This is a new Docker-only protocol after controls.
Whole recovered cloud turn279.441s exceeded requested preparation<=240s by39.441s.
Timestamped source-inspection-to-final-package subset218s excludes earlier turn work;
it cannot prove the requested full preparation budget was met.

Local pure/syntax checks use Node v24.20.0, 256MiB heap, independent15s per process.
They do not establish runtime correctness or performance on target Node v24.19.0.
