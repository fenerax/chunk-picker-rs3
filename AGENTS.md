# Chunk Picker agents

Read `README.md` for the current runtime and `PRODUCT.md` for product decisions. For tests, use `docs/testing.md`; for a PR review, use `docs/pr-review.md`.

## Public history

- Keep personal identities, real saves, operational internals and nonpublic inputs out of this repository and its history; use synthetic fixtures.
- Use the repository's configured GitHub noreply address for both author and committer. Check both identities before publication, because the publication guard refuses other addresses.
- Omit AI coauthor email trailers: the corpus scanner rejects unapproved email addresses in commit messages too.
- Standing authorization of 2026-10-21 permits ordinary pushes to `fenerax/chunk-picker-rs3` main after a clean corpus scan and noreply checks. History rewrites, tags, releases and asset uploads need their own authorization; explicit task restrictions take precedence.

## Verification

- Use the existing common `.git/hooks/pre-push` scanner with the local corpus. Never set `core.hooksPath`; the tracked `.githooks` hook omits the corpus and refuses publication.
- Before pushing, fetch `origin/main` and run targeted tests for the changed behavior, respecting task-specific test limits. Use `docs/testing.md` for the test environment and shared-PC lock, BelowNormal priority, one worker and ten-minute lease. Targeted local checks still require the complete CI gate.
- When a change adds a browser module or static route, run `tests/server.test.mjs` and `tests/browser-module-graph.test.mjs`.
- Explore the UI after releases and UI changes on an isolated synthetic server. Treat difficulty finding controls as a usability defect; keep exploratory writes away from live saves.
- After gallery, response-header or browser-startup loading changes, check real samples both directly and inside the gallery frame; direct previews miss frame-policy and fetch-guard failures.
- Before removing a worktree, preserve ignored pinned inputs needed to reproduce its committed outputs.
