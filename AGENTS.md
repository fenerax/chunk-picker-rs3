# Chunk Picker agents

Read `README.md` for the current runtime and `PRODUCT.md` for product decisions. For tests, use `docs/testing.md`; for a PR review, use `docs/pr-review.md`.

## Public history

- Keep personal identities, real saves, operational internals and nonpublic inputs out of this repository and its history; use synthetic fixtures.
- Use the repository's configured GitHub noreply address for both author and committer. Check both identities before publication, because the publication guard refuses other addresses.
- Omit AI coauthor email trailers: the corpus scanner rejects unapproved email addresses in commit messages too.
- Standing authorization of 2026-10-21 permits ordinary pushes to `fenerax/chunk-picker-rs3` main after a clean corpus scan and noreply checks. History rewrites, tags, releases and asset uploads need their own authorization; explicit task restrictions take precedence.

## Verification

- Before pushing, fetch `origin/main`, inspect `npm run test:affected -- --list`, then run `npm run test:affected`. It runs the selected files at BelowNormal priority with one worker and stops on failure. Tests reaching an unresolved loader stay selected, so shared runtime changes can produce broad checks. Follow task-specific focused-test limits and `docs/testing.md` for the shared-PC lock and ten-minute lease. CI runs affected files first within each full-suite shard; a local pass still requires that complete gate.

- Explore the UI after releases and UI changes on an isolated synthetic server. Treat difficulty finding controls as a usability defect; keep exploratory writes away from live saves.
- After gallery, response-header or browser-startup loading changes, check real samples both directly and inside the gallery frame; direct previews miss frame-policy and fetch-guard failures.
- Before removing a worktree, preserve ignored pinned inputs needed to reproduce its committed outputs.
