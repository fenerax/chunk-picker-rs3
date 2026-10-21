# Cleanup verification — 2026-10-12

Source: `codex/cleanup`, Node v24.20.0 on the Windows desktop. F3, F4 and F8 cover rule visibility, retirement of the old Task rules editor and the quick test command.

- Focused Rules, Settings and metadata checks: 40 passed. The authenticated browser-module dependency check also passed.
- Quick suite: 39 files, 449 passed, zero failures or skips, 14.3 seconds excluding the shared-lock wait.
- Full `npm test`, run once through `.local/with-heavy.ps1`: 263 files, 2,865 tests; 2,863 passed, one failed, one skipped. Execution took 423.6 seconds.

The full-suite failure is `tests/updates.test.mjs` validating the roadmap: **C5** has `status: "done"` but no `done` date. `git show HEAD:app/data/roadmap.json` confirms the same pre-existing record. Neither the roadmap nor changelog JSON was changed; Claude owns those shared files. This failure remains for the merge handoff.

The isolated browser used a copy of the live duo store, excluding `store.lock` and `access-token`, at localhost ports 8901/8902. Checks at 1440 × 900 and emulated 390 × 844 confirmed normal hiding, one initially folded Advanced group, read-only kept rows, functional controls and no horizontal overflow or runtime/CSP errors. Both members' task-rule dictionaries and the retained original-map payload stayed byte-for-byte equal before and after the UI checks. The copied save had 34 kept rows: the 23 catalogue keys plus 11 additional saved historical keys.

The server and browser stopped and the copied store/profile were deleted. The initial browser attempt needed a fixed-port readiness correction in the local harness; it also cleaned up, and no full suite ran during that attempt.

Screenshots and logs remain under the worktree's ignored `.local/screens/`:

- `cleanup-desktop-1440-normal.png`, `cleanup-desktop-1440-advanced.png`
- `cleanup-phone-390-normal.png`, `cleanup-phone-390-advanced.png`
- `browser-result.json`, `quick-test.log`, `quick-result.json`, `full-test.log`, `full-result.json`

No callers of `settingsPanels.taskRules`, `panel.taskRules`, the old `function taskRules()` editor, `.task-rule-grid` or `.checkbox-setting` remain. Existing task-rule commands and preference keys retain their contracts. In-memory tests cover preset preservation, sync, backup, profile export and Undo; explicit profile imports keep their existing replace-and-review behavior. The unused gameplay effects themselves remain unimplemented.
