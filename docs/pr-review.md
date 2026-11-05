# Focused PR review

Use this workflow for a read-only pre-merge review of Chunk Picker changes. Honor the requested severity and test budget; when only P1/P2 defects are requested, omit style comments and speculative risks.

## Establish the review

1. Record each target head, baseline SHA, review boundary and test constraint. Inspect remote URLs and fetch refspecs before assuming that `origin/main` is the right baseline. The maintained public source is `https://github.com/fenerax/chunk-picker-rs3`; the historical upstream is a different repository.
2. If refs are missing and fetching is permitted, fetch explicit public refs into a dedicated review namespace. Record the fetched SHAs; avoid overwriting an unrelated remote's tracking refs.
3. For untrusted-input changes, agree in the first round on realistic impact, comparison with the baseline, size limits and the permitted main-thread stall. Split large export/import/isolation changes and fix defect classes with generic coverage.

## Trace and verify

1. Diff each target against the recorded baseline. Trace changed data through saved-state migrations, calculation snapshots, engine decisions, UI projections, Undo and export.
2. Run only the authorized focused files, one at a time, with the environment selected by `testRunPolicy` in `scripts/test-selection.mjs`. A bare `node --test` invocation can select a different dataset. Add a small synthetic reproduction only when needed to prove the edge case.
3. For migrations, exercise old-save validation, sparse Undo patches for newly created containers, Undo and re-export. For passive retained-state UI, check that projections remain GET-only, do not start calculations or acquire leases, and discard stale identity/revision responses.
4. If reviewed PRs overlap, use `git merge-tree` on their recorded heads. Distinguish a source conflict from appended test additions that must both survive.
5. Stop after focused verification and relevant dataflow tracing establish whether a reproducible defect exists. Do not broaden into an unrequested full-suite run.

## Report

For each finding give severity, file and line, minimal inputs or steps, observed wrong behavior, expected behavior, and a suggested fix direction. State the merge verdict, baseline/heads, focused checks and their results, cross-PR overlap, and any unrun hosted Linux/CI checks. A local Windows check is not hosted-CI evidence.

Keep the review free of authored changes, commits, pushes, merges and GitHub comments unless separately requested. Fetches used to establish refs must be disclosed as such.
