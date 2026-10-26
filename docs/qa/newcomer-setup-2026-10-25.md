# Newcomer setup verification

Requested report date: 2026-10-25. Verification performed 2026-10-26.

START: `90dcb2aaf181e036dfd9dacf9807ecf59d9720cd`.

## Method and scope

Started with README.md and its linked notices, then checked the testing and
plugin guides added to the public setup path. The first replay used a clean
tracked export of START, without existing runtime stores or Wiki caches. The
final replay used a fresh local Git clone of the same public checkout. Cloning
was local; no GitHub requests, pushes or pull requests were made. No other
repository, private dataset or personal save was used. All gameplay, invitation
and plugin checks used newly created synthetic stores.

The initial runtime was Node 24.19.0 with npm 11.9.0. An official Node 24.20.0
Linux distribution, verified against its published SHA-256 manifest, was used
with its bundled npm 11.19.0 for final validation after isolating a test-event
compatibility issue. Chromium ran headlessly with an isolated browser profile; browser controls were driven
through its debugging protocol. No browser package or npm dependency was added.

This test container's init does not reap orphaned children. A disposable Linux
subreaper parent supplied that init behavior for the final npm commands. It
reaped exited children and preserved the npm process's exit status; it did not
change tests, filtering, assertions or repository code. No app code, npm
scripts, tests, changelog or roadmap files were changed.

## Step-by-step results

| Step | What happened | Documentation correction |
| --- | --- | --- |
| Obtain the source | A tracked export and a fresh local Git clone both supplied the public files. The README previously began with `npm start` without checkout or working-directory instructions. | Added public clone/archive instructions and made the repository root the working directory for all commands. The remote clone command was not executed because this task forbids touching GitHub. |
| Check prerequisites | Node 24.19.0 started the app, but the synthetic coverage test failed because native events lacked `entryFile`. The same five coverage tests passed on 24.20.0. | Require Node 24.20.0 or a newer 24.x, npm and a current browser; explain the older-runtime test failure. Git is needed only for cloning. |
| Install dependencies | Started both clean copies without `npm install`, `node_modules` or a build. | Explicitly state that no dependency install, build, account, client, plugin, private save or download is needed. |
| Start included F2P data | `npm start` printed the ready address and created a fresh two-player game in `var/open-f2p`, plus its sibling dataset binding. | Document the ready message, persistent storage, binding and keeping the terminal open. |
| First browser access | An unauthenticated request to `/` returned 401. Opening `/join/<token>` using the new store's token established an administrator session and redirected to `/`; Chromium showed “F2P journey” and the setup guide without a startup error. | Replace the ambiguous token-appending wording with the exact URL shape, local token-reading instructions and session behavior. Explain that loopback refers to the server's machine. |
| Choose a starting chunk | Fresh maps had zero unlocked chunks and no roll pool. Skipped setup, searched for `12850`, selected View and clicked Unlock. Lumbridge unlocked and four neighbours became rollable. | Add the missing starting-chunk step and the actual visible control names, separately for each player. |
| Roll, tick, Undo and reload | Rolled a neighbour: unlocked count rose from one to two. A synthetic task tick raised Completed to one; Undo returned it to zero. Reload retained the two unlocked chunks and showed no startup error. | Replace the stale “Roll 1” button instruction with the selected player's roll button and explain save/reload behavior. |
| Alternative game and F2P alias | The explicit port/storage form started a separate F2P store. `npm run start:f2p -- --port 8953 --data-dir var/another-game` also started successfully from the clean clone. | Explain the alias, 8900–8999 port range and matching token path/port for a second game. |
| Invalid port/storage reuse | A second server on the occupied port exited 1 with `EADDRINUSE`; the existing server remained available. Selecting open-starter with F2P-bound storage exited 1 with a binding refusal. | Explain occupied ports and incompatible/nonempty storage instead of implying arbitrary reuse is safe. |
| Local invitations | Created a View only link through Admin → Invite links. Joining returned 303, the resulting session was read-only/non-admin, and a write returned 403. Revocation made both that session and the join link return 401. | Add creation/copy/revoke steps, permission distinctions and local-only reachability. Explain that this launcher clears public-hosting settings and does not publish a server. |
| Optional invented dataset | `node scripts/start-independent-game.mjs` started on 8950 with separate `.local/open-starter` storage. Its own token opened “Grid challenge” in Chromium. | Give the existing script command, address and token location, without requiring legacy packs or a missing npm alias. |
| Optional game plugin | Created a dedicated key in More → Game plugin on a separate scratch F2P server. The simulator exited 0 with four status responses and `pendingProgress: true`. The dialog displayed three skills, Cook's Assistant, an unmatched synthetic quest and a beta warning. Revoked the key afterward. No proposal was applied. | Distinguish the picker API/simulator from a game-client installer. Document scratch startup, authentication, map selection, Create plugin key, environment setup, review and revocation. No real account is required. |
| Optional Wiki regeneration | The batch fetch retried and exited 1 because Wiki network access was unavailable here; the environment does not allow the Wiki host. The offline build without the cache exited 1 with a missing pinned-response file. Runtime startup still worked using the tracked dataset. | Label regeneration optional, state its public network/cache prerequisites, name its output and stop after a failed fetch. Give the included dataset as the public offline alternative. A real network rebuild was not verified. |
| Test discovery | Quick listed 271 files and full listed 612. Both commands discovered successfully without private inputs. | Link the corrected testing guide and show the real list commands. No test files were added, so selection classification did not change. |
| Test runner guidance | The current runner is adaptive, starts at two files, caps at six for full/two for quick by default, and reserves memory above a 4 GiB floor. The old guide described fixed three-file concurrency, an override of 1–8 and a stale speed target. | Describe actual admission, 1–6 cap overrides, heavy-file isolation, optional skips and sufficient free memory. Remove the portable 60-second implication. |
| Maintainer-only test tooling | `npm run test:timing -- comparison` failed with “Missing script”. The old guide also assumed ignored local PowerShell wrappers. | Remove these as setup requirements, identify legacy measurement tooling as optional and give ordinary suite commands and shell timing instead. |
| Container process lifecycle | The initial full run failed its orphan-worker exit check because this container leaves exited children as zombies. All eight process-worker tests passed under Node 24.20 with a child-reaping parent. | Document a reaping init for Linux test containers, such as Docker's `--init`; do not change the app to accommodate a missing init. |
| Stop and restart | Ctrl+C stopped the test servers. Starting the clean-clone server on the same default port then succeeded. | Retain Ctrl+C instructions and explain later launches resume the selected store. |
| Links and platform examples | Every local Markdown link in the changed setup documents resolved. PowerShell is unavailable in this Linux container, so those alternative shell snippets were reviewed but not executed. | Keep POSIX and PowerShell environment-variable examples distinct; do not require Windows-only helpers for public setup. |

## Suite results

Runs were sequential. The initial full run followed the initial quick run;
the final full run followed the final quick run. Full suites were executed
on this test machine, not deferred to another system.

| Runtime / environment | Command | Pass | Fail | Skip | Reported duration |
| --- | --- | ---: | ---: | ---: | ---: |
| Initial Node 24.19.0, container without a reaping init | `npm run test:quick` | 2311 | 1 | 65 | 95.155 s |
| Initial Node 24.19.0, container without a reaping init | `npm test` | 5341 | 2 | 137 | 413.076 s |
| Final Node 24.20.0, clean clone with a child-reaping parent | `npm run test:quick` | 2312 | 0 | 65 | 96.811 s |
| Final Node 24.20.0, clean clone with a child-reaping parent | `npm test` | 5343 | 0 | 137 | 413.892 s |

The initial failures were the coverage reporter's native metadata check and,
in full only, the orphan-worker process exit check. The documented runtime and
container prerequisites address those independently. Both final commands exited 0. Skips cover optional or platform-specific checks;
they are not counted as passes.

## Measurements and remaining limits

This is a documentation-only change, with no runtime performance claim. Paired,
alternating before/after benchmarks, medians, spread and peak-memory comparisons
are not applicable. Suite durations above are single-run diagnostic observations,
not a controlled speed comparison: the Node version and init behavior changed.
No measurement script was added.

The core local setup, browser flow, separate public datasets, local invitations
and synthetic plugin path were exercised. Wiki regeneration, Internet hosting,
a real game-client plugin and Windows-only execution were not verified here.
The README explicitly separates those from the included public local setup.
Old Node 24 minors and containers without a reaping init remain unsuitable for
the documented test commands. No credentials, full join links, private hostnames
or personal data are included in this report.
