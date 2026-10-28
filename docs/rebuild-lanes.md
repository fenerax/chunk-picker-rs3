# Rebuild lanes

Two pieces of work run side by side:

- **Multiplayer**: anyone can sign in and get their own picker. Contract:
  `docs/multi-picker-contract.md`.
- **Engine**: a faster, smaller calculator, in whatever language wins a
  measured bake-off. Boundary: `docs/calculator-protocol.md`. Correctness gate:
  `docs/calculator-check.md`.

Ordinary fixes keep landing on `main` as before. The RuneMetrics replacement
(sync closes 10 November 2026) comes before both lanes whenever they compete.

## Branches

- `main` stays releasable. Lanes never push to it directly.
- `lane/multiplayer` and `lane/engine` are integration branches cut from `main`.
- Each task branches from its lane branch and returns as a pull request into
  that lane. One task, one branch, one pull request.
- `main` is merged into each lane often, at least before every lane-to-main
  merge. Lanes are never merged into each other.
- A lane reaches `main` only through a pull request that passes that lane's gate
  below, reviewed by the orchestrator.

## Who owns what

A task changes only files its lane owns. If it needs a change in the other lane's
files, it stops and reports what it needs; the orchestrator sequences it.

| Multiplayer owns | Engine owns |
| --- | --- |
| `app/server.mjs` and HTTP routing | `app/tasks/engine.mjs` and every module the calculator imports to compute (`access`, `collection`, `equipment`, `presentation`, `time-estimates`, `activity`, `area-check`, `chunk-planning-index`, `map-task-locations`, `unlock-reuse` fingerprints) |
| `app/storage/**`, accounts, invitations, sign-in, plugin keys and routing, overlays, usage | `app/core/planning.mjs`, `evaluateRollPool` in `app/core/rules.mjs` |
| `app/tasks/scheduler.mjs`, `process-worker*.mjs`, the calculator pool | the new calculator program, under `calculator/` |
| `scripts/linux/**`, operator and backup tooling | the checker, under `tools/calc-check/` |
| browser account and picker UI | engine benchmarks under `scripts/perf/` |

Shared, changed only through a protocol pull request (see the protocol's last
section): `docs/calculator-protocol.md`, the message handling in
`app/tasks/worker.mjs`, and the reference adapter.

Game behavior belongs to neither lane. `app/core/state.mjs` commands, rules and
pack data do not change inside a lane. If a lane finds a game bug, it reports it;
the fix lands on `main` first and both lanes pick it up.

## Gates

**Engine to `main`:**

- `calc-check` reports zero differences on the full corpus, real saves included.
- The new calculator ships behind a switch that defaults to the reference
  calculator. Turning it on for the live site is a separate, approved release.
- It is measured on a VPS-shaped run (same pack, process mode, the footprint
  harness) against the reference: compile time, core-seconds per evaluation and
  RSS. It must win on the numbers that matter for many pickers, not one.
- It builds from a clean checkout with a documented command on Linux x86-64. A
  Windows build is wanted for local work but does not block.

**Multiplayer to `main`:**

- Core CI green, plus the Phase 1 acceptance tests in the multi-picker contract.
- The shared duo is unchanged: `calc-check` in duo mode gives identical results
  before and after, and its save opens without migration loss.
- The footprint harness is rerun and the results added to
  `docs/perf/picker-footprint.md`.
- Public sign-up stays switched off until the owner approves opening it.

## Private data

Real saves and the full packs live in a private repository, never in this one.
Cloud tasks that need them use the private-data Cloud environment. In this
public repository (code, tests, fixtures, commit messages, pull request text and
logs) report only counts, hashes, durations and difference counts. Never state
contents, member names, task text from a real save, or credentials. The private
data contains gameplay only; sign-in records, sessions, invitations, plugin keys
and tokens are never copied anywhere.

## Task briefs

Every task brief names its lane, its base branch, the files it may touch, the
gate it must pass, and the rules above. Commits use the owner's GitHub noreply
address. No force pushes. A task that cannot meet its
gate says so plainly and stops; it does not weaken a test or the checker to pass.
