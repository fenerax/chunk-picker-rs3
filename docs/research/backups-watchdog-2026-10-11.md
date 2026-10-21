# Backup notices and worker recovery

Implemented roadmap G3 and G2 on `codex/backups`, from
`d229b032a5c80ec331498a5979e7c316f5d1e7a3` (`claude/redesign`). Checks ran on
October 11–12, 2026. The live picker, main checkout, Tailscale and scheduled
tasks were left untouched.

## Behavior

Admins see **Last backup** in More and Backup & Import. A separate persistent
notice covers a failed run, a successful backup older than two days, a missing
destination, or missing/unreadable records. Opening either surface refreshes
the status; visible admin pages also check every 15 minutes. Player 2's non-admin
invitation makes no status requests. The dialog status line uses a weak
reference so it cannot retain a replaced dialog and its file preview.

Backup-Picker writes atomic local metadata and retains the last successful
time after failure. The server bounds status/configuration/log reads and
returns only times, result, size and a warning code. It never returns paths,
file names, revision, credentials or backup contents through this endpoint.

Authenticated health reads inspect existing calculators without waking them.
Active or queued work with over two minutes without progress is marked stuck;
stage-completion messages carry only a request number. The admin recovery
endpoint retires affected workers before allocating replacements, rejects old
calculation waiters for retry, and leaves healthy/sleeping lanes untouched.
Watch-Picker checks recovery even when its replacement request times out. It
uses ownership-checked Stop then Start only after failed recovery or an
unavailable HTTP listener, and preserves deliberate pauses.

## Copied-save checks

Both revisions used the same complete copied revision-97 save. The copy
excluded the live lock, invitations and feedback. Baseline and candidate
servers ran separately on localhost; the candidate Windows helpers used port
8874. Game data and map assets were read from the main checkout without writes.

| Player / returned data | Before | After |
| --- | ---: | ---: |
| Player 1 unlocked chunks | 158 | 158 |
| Player 1 selected chunks | 2 | 2 |
| Player 1 task rows / available rows | 20,640 / 1,681 | 20,640 / 1,681 |
| Player 2 unlocked chunks | 114 | 114 |
| Player 2 selected chunks | 19 | 19 |
| Player 2 task rows / available rows | 20,592 / 1,673 | 20,592 / 1,673 |

All returned task rows matched by SHA-256, including their status and details.
The full portable saved state also matched before/after and after the browser
checks. These row totals include blocked and intermediate rows; they are not
the Active Tasks count.

- Raw source state: `7d160d0f286693fc48be8b0f0db2170554d996bab97a867325bafe3e36cdff47`.
- Full portable state: `71eadb5d2f09e479abaf5aee36b5a81deacc691ed196588d6658652f09c2104c`.
- Player 1 task rows: `f3936a634e137f822c349dbb46695e959f94c1fafd066e8917f32a3c6045dbef`.
- Player 2 task rows: `eb2737df9cc3f58231121b4f17dfcd89dc8ffee434c4d495a51d650830426326`.

With a one-second test idle interval, every calculator was non-resident before
the real backup helper ran. The full backup succeeded, health reads and the
real watchdog tick left them asleep, and the server PID stayed unchanged.
Missing configuration, a three-day-old status and a deliberately failed local
destination produced the expected notices; failure retained the prior success
time. Player 2's browser opened More and Backup & Import with zero status requests,
and the status endpoint rejected his session. Separate HTTP fixtures also
rejected non-admin worker recovery.

## Verification and captures

`npm test`: **2,356 passed, zero failed, one intentional skip** (2,357 total).
The initial run caught a corrected authentication mistake in the new fixture
and a transient closed connection in the existing map-reference fixture. That
map test passed separately, and the complete rerun passed. Six focused status
UI tests also passed after the weak-reference change. Prediction goldens and
provenance data were unchanged.

Fake-clock tests cover the exact two-minute boundary, progress, stale worker
messages, active/queued work, a stuck peer while the foreground sleeps,
exhausted automatic retries, coalesced recovery and delayed retirement.
PowerShell fixtures cover atomic backup status, ZIP contents, retention,
credential redaction, worker-first recovery, uncertain POST outcomes, fallback,
ownership refusal and deliberate pauses.

The desktop and 390 × 844 captures were inspected in gray and light themes.
The notice wraps without horizontal overflow, and Backup & Import fits the
narrow viewport. Local screenshots are retained under:

- `.local/backup-screenshots/`: copied-save failed-backup notice, More and Backup & Import.
- `.local/perf/backups-after-screenshots-2026-10-12T03-42-17-521Z/`: settled desktop-gray and 390px-light views for all three runs.

The copied-save screenshots used the short idle interval; the settled perf
captures used the production ten-minute interval. Browser dimensions do not
verify phone hardware or Player 2's device. No live deployment or scheduled-task
registration was performed. Temporary saves, ZIPs, server records and browser
profiles were removed after their processes stopped.

## Performance

Three candidate and three quiet-baseline repetitions used normal prewarming,
personal view, `--scenarios reload,switch-player2,switch-player1 --settlement tasks`,
Node 24.20.0 and Chrome 154.0.8037.98. Servers and browsers ran serially, with no
test suite alongside them. Times are median milliseconds.

| Task milestone | Before | After | Change |
| --- | ---: | ---: | ---: |
| Reload | 1,004 | 911 | -9.3% |
| Switch to Player 2 | 4,985 | 4,682 | -6.1% |
| Switch to Player 1 | 419 | 380 | -9.2% |

All selected latency medians meet the approximately 10% regression gate.
Median server RSS at readiness/after was 1,368 / 2,495 → 1,436 / 2,489 MiB:
readiness +5.0%, after -0.2%. Reports retain every repetition and have zero
failed requests. The added notice changes viewport geometry, and host load
varied, so these results establish the gate without a causal speedup claim.
Unlock, complete Group view and throttled-network timing were not measured
in this bounded comparison.

Ignored local reports:

- Busy baseline: `.local/perf/backups-before-2026-10-12T02-57-03-901Z.json`.
- Candidate: `.local/perf/backups-after-2026-10-12T03-43-49-595Z.json`.
- Quiet baseline: `.local/perf/backups-before-quiet-2026-10-12T03-47-12-553Z.json`.

The busy baseline's 8,545 / 24,911 / 1,473 ms task medians and 1,227 / 3,196 MiB
RSS are retained separately; they are not used for the comparison above.
The candidate was measured before commit, with its dirty flag recorded. The
complete application manifest pins baseline SHA-256
`ac2441e553d47dbee450689ca9e1e0092a022719085250be5aaa948e0de7a8fb`
and candidate
`3b3c6fd0d91190dbf301d51425769d71adfaa2a3bcc6d49cea2720bfcd13fb06`.
The harness checked source fingerprints again after each batch.

## Main screen merge — October 12

Merged `claude/redesign` (`5d4c369`) into the backup branch based on `58351fb`.
`main.mjs` is byte-identical to the redesign's 34-line composition file. The
screen context owns the backup controller; startup creates it and starts it
after the admin session loads, dialogs show its status line, and controls refresh
it from More and include its notice in responsive sizing. Both explicit static
allow-lists and the screen-graph test harness are retained. Scheduler, worker,
backup script and watchdog script bytes are unchanged from `58351fb`.

Full `npm test`: 2,357 tests, 2,356 passed, zero failures/cancellations, one
existing generated-PNG test skipped; 606.88 seconds. Targeted screen fixtures
also passed 164/164. Prediction goldens and `.gitattributes` are unchanged.

Five three-run batches used the same frozen revision-97 save, Node 24.20.0,
Chrome 154.0.8037.98, personal view and task settlement. Servers and browsers ran
serially, with the full suite finished beforehand. Median task milliseconds:

| Batch | Reload | Player 2 switch | Player 1 switch | RSS ready / after (MiB) |
| --- | ---: | ---: | ---: | ---: |
| Normal baseline | 1,938 | 5,902 | 1,828 | 1,378 / 2,738 |
| Normal merged | 3,331 | 8,793 | 1,403 | 1,384 / 2,766 |
| Normal baseline repeat | 2,929 | 6,365 | 424 | 1,377 / 2,899 |
| Warming-off baseline | 2,717 | 8,108 | 701 | 1,376 / 2,315 |
| Warming-off merged | 1,549 | 5,811 | 472 | 1,378 / 2,138 |

The controlled comparison meets the approximately 10% band and reduces its
post-suite RSS by 7.6%. Normal RSS differs by +0.4% at readiness and +1.0% after
against the first baseline. Normal latency does not establish the gate: reload
and Player 2 exceed both normal baselines, and Player 1 varies widely. A host CPU
sample reached 100% while 7.9 GiB of 31.95 GiB remained free. All normal suites
have five foreground requests, two hits, three completions, zero errors and
three cached entries (~8.96 MB). Each scenario has one task request; backup
status runs once on reload and never on switches. Player 2's delays include more
worker time; one merged cached Player 1 request records 2.6 ms server request time
but ~8 seconds network TTFB. Those observations localize delays without proving
their cause. A quiet-host normal-warming recheck remains outstanding. No
production settings changed, and these results do not support a causal speedup
or slowdown claim. Unlock, Group view and throttled-network timing were not run.

The raw save SHA-256 remained
`7d160d0f286693fc48be8b0f0db2170554d996bab97a867325bafe3e36cdff47`.
Archived baseline application SHA-256:
`3b3c6fd0d91190dbf301d51425769d71adfaa2a3bcc6d49cea2720bfcd13fb06`.
Merged application SHA-256:
`c9245d52709624ab7b0889a9802a27925ca8e18147c8cb9ac7b44f295ce4c248`.
The harness verified those manifests again after every batch.

JSON/Markdown report pairs under ignored `.local/perf/`:

- `backups-merge-before-2026-10-12T04-15-29-073Z`.
- `backups-merge-after-2026-10-12T04-20-59-670Z`.
- `backups-merge-before-repeat-2026-10-12T04-25-16-965Z`.
- `backups-merge-controlled-before-2026-10-12T04-30-55-666Z`.
- `backups-merge-controlled-after-2026-10-12T04-34-47-277Z`.

Copied-save browser checks passed at 1440×900 in gray and 390×844 in light,
with settled tasks and visible terrain. Both layouts fit without page overflow;
the admin sees the calm missing-destination notice and Last backup line in More
and Backup & Import. A simulated failed local status refreshes the warning.
Player 2's player-linked non-admin invite receives HTTP 403 for the status endpoint,
makes zero browser status requests and shows no backup notice or dialog status
line. No JavaScript exceptions were observed. The checker waits for an earlier
status request to finish before simulating the next result and reopening More.

Raw revision-97 save bytes match before and after. Player 1 stays at 158 unlocked,
2 selected and 16 personal completions; Player 2 stays at 114 unlocked, 19 selected
and zero personal completions. Displayed possible-task counts remain 1,650 and
1,626 respectively. Local evidence is `.local/backups-merge-browser-checks.json`
and six PNGs under `.local/backups-merge-screenshots/`: `desktop-gray.png`,
`desktop-gray-more.png`, `desktop-gray-backup.png`, `390-light.png`,
`390-light-more.png`, `390-light-backup.png`.

All owned servers and browsers are closed. The private save copies, archived
baseline and browser profile are removed; reports and screenshots remain local.
The live picker, scheduled tasks, Tailscale and main checkout were not changed.
