# Public core with private packs: M6 shadow evidence

Date: 2026-10-14  
Completed locally: 2026-10-15. Milestone 6 passed; milestone 7 was not executed.

This report covers milestone 6 of [the public/private split plan](public-private-split-plan-2026-10-13.md), including the hosted-access requirements in section 6. The shadow uses the public candidate application with copied, pinned private packs and disposable storage. The existing hosted picker, live storage, invitation links and selected inputs remain unchanged. No push, remote creation, publication or live switch is part of this work.

## Artifact and input identity

The final public artifact is `C:/Users/User/Projects/chunk-picker-rs3-public-m6shadow-verified`.

| Evidence | Value |
| --- | --- |
| Source revision | `51f3d38` |
| Public commit | `a204768c78a441da93943c8175f4cdd56228eb86` |
| Public Git tree | `a2162d5e52b3eda89fb9c96252c4562a28f43319` |
| Output tree SHA-256 | `8bc050e67c5df97c20e12b642d067b99501f4be41fcf7dfb76f279d33379275c` |
| Exported files | 639 |
| Captured `state.json` SHA-256 | `892805a52fd5661ce62db568a02f2c4d8d94d2bcb89a1b19b09e98a50443d29b` |
| Captured member count | 2 |
| Private descriptor SHA-256 | `73b71c61e21f4b496d95844340103f0fe598316c6ec9c0682e98ee4a9d4ae68f` |

Pack copies were checked against their manifests, including every listed payload file. Counts and bytes below describe listed payloads.

| Pack | Files | Bytes | Manifest SHA-256 |
| --- | ---: | ---: | --- |
| `duo-data` | 97 | 163,557,193 | `401d85d1aa4a4af94fa6a28e4e45666b5c4f8ee87178ef1619fae8beb0b135e0` |
| `duo-rules-text` | 4 | 578,092 | `eafd8808de44c1c4d158ccc1a5e4d7416dc51011cb0a4b05bb20e2599c1fc9f1` |
| Art | 15,297 | 240,614,960 | `0b41350c9e30062189d38bbc24a0d7f3b517ba56d583b5490e1d6265b1cdce86` |

The original selected packs were read only. Every copied payload matched its manifest byte length and SHA-256. All disposable saves, copied packs, temporary profiles and five duplicate exports have been removed. No owned server or Chrome process remains. The clean public artifact remains at the path above; its private trial installation has been removed.

The [release receipt](../../.local/m6shadow/release-receipt.json) binds the candidate, input receipt, test logs, parity results, screenshots and cleanup audit by digest. Reports contain hashes and counts, without saved member values or credentials.

## Runtime gaps and the implemented seam

The public export deliberately excluded legacy runtime modules. Selecting private packs alone did not make the exported application runnable:

| Gap in the starting candidate | Implemented behavior |
| --- | --- |
| `datasetCatalogue()` imported excluded `dataset-inputs.mjs` | An installed, inert JSON descriptor supplies the catalogue arrays. |
| Legacy provider/default helpers imported excluded `legacy-game-defaults.mjs` | The descriptor supplies the existing private defaults. `loadGameDefaults()` also reads the installed descriptor. |
| Browser catalogue materialization imported the excluded catalogue module | The packed provider supplies `materializeValues()` from verified pack values. |
| Packed bootstrap imported excluded `data/original-data.mjs` | The shared bootstrap reads the selected provider's bytes, validates contained paths and checks the existing repository-text hash convention for legacy data. Independent data retains raw-byte hashing. |
| Legacy sync imported excluded server/UI modules and their capture/task-review dependencies | The installed-profile provider declares `originalSync: false`. |
| Gallery and project-update controls defaulted to enabled while their files were absent | The installed-profile provider declares `gallery: false` and `projectUpdates: false`. |
| Public npm startup forced an independent dataset and removed pack configuration | A separate private operator shadow launcher selects `duo-legacy` before application imports and names disposable storage and a separate local port. |

`app/dataset-profile.mjs` loads a profile only with an absolute operator path and required SHA-256. It rejects links, oversized or changed files, invalid schema, unsupported fields, invalid catalogue paths and invalid defaults. `resolveDataset()` requires selected packs when a profile is installed, verifies ordinary pack contracts and hashes, then compares the descriptor's dataset digest and rule-contract hash. These checks precede storage preparation. The profile supplies no executable modules, hooks, routes, assets or authentication policy.

The private-only `scripts/build-dataset-profile.mjs` reads the unchanged source catalogue and legacy defaults. It verifies the selected copied data-pack manifest, writes the descriptor with exclusive creation, and reports only a digest and counts. No private dataset-input file was edited or selected pack rebuilt. The required private dataset-parity check built and deleted its own disposable verification pack. Ordinary private startup without a descriptor retains its existing provider and defaults.

Workers receive the profile path and hash through `workerSelection()`, together with the selected packs and expected dataset digest. The base capabilities continue to bind the existing pack digest. Installed-profile utility restrictions are applied consistently to the resolved provider and browser payload.

The changed profile, bootstrap, defaults and dataset resolver modules run in Node. Browser `dataset-runtime.mjs` takes its fetch branch and receives catalogue/default data as JSON; it does not import these Node modules. No browser-loaded code changed. The additional private gallery check nevertheless passed all 95 previews both plain and with `FRAMED=1`.

The only observed provider differences are these three utilities. They are asserted before comparison, rather than silently discarded:

| Utility | Private app | Public core with installed profile | Reason |
| --- | --- | --- | --- |
| Original-picker sync, original import and migration report | Available | Controls absent; affected routes return 404 after authentication | The original-service client and review modules are deliberately excluded. Normal backup restore remains available. |
| Development gallery | Available; 95/95 plain and framed | Hidden; `/gallery` returns 404 | The public export excludes the private preview application. |
| Private changelog and roadmap | Existing feeds and controls | Controls hidden; empty `entries`/`items` feeds | These private project records are excluded from the public tree. Neither source JSON file was edited. |

All other compared gameplay, rule/default, saved-state, art and access results matched. The ordinary private provider retains these utilities unchanged.

## Export repair and completed checks

The starting export policy omitted three existing F2P generator helper modules. The first public quick run failed with `ERR_MODULE_NOT_FOUND`. The repair adds those existing modules to the allowlist only; it changes no F2P source or test file. The regenerated candidate passed the leak scan.

All 394 exported application files match the earlier shadow candidate byte for byte; the helper additions are outside `app/`. The final browser and expanded parity run used the verified 639-file artifact itself. The [byte audit](../../.local/m6shadow/runtime-byte-audit.json) and release receipt retain this identity check.

| Check | Recorded result |
| --- | --- |
| Private quick suite | 1,407 passed, 1 skipped; initial run took 196 seconds on a contended PC |
| Focused seam checks | 20 passed |
| Export tooling checks | 25 passed |
| Public quick after allowlist repair, 119 files | 1,114 passed; 1 optional skip; zero failures |
| Public full, 222 files | 2,352 passed; 1 optional skip; zero failures |
| Private full, 413 files | 4,144 passed; 2 optional skips; zero failures; run once, 19m39s |
| Private full source audit | All 8,918 tracked files identical before/after the run |
| Private dataset parity under heavy lock | Zero differences; read-only bytes unchanged; Undo restored |
| Expanded public/private shadow under heavy lock | 48 hash comparisons; zero hash or count differences |
| Final leak scan and actual private negative probes | Zero findings; all private probes rejected; no scanner waivers added |
| Re-export from latest implementation HEAD | Identical 639 files, tree hash, Git tree and public commit |
| Fresh public history | One commit, zero remotes/unreachable objects, clean index |
| Light-locked desktop/phone browser | Both workflows passed; zero page errors, outside requests or page overflow |
| Private gallery | 95/95 plain; 95/95 with `FRAMED=1` |
| Cleanup | Every real-save copy and copied pack removed; zero owned scratch processes |

The private [full log](../../.local/m6shadow/private-full.log) and [source audit](../../.local/m6shadow/private-full-source-audit.json) are retained. The shared optional skip is the absent pinned Wiki cache; synthetic offline generation still ran. The second private skip is the absent optional generated PNG bundle.

The scanner intentionally refuses Git directories. Its final run used a byte-verified projection of every working file, with the fresh root Git history audited separately. No exception was added for Git or private data. The [final scan receipt](../../.local/m6shadow/final-scan.json) records that scope. Earlier harness attempts exposed Windows preload URL, expression escaping and asynchronous UI-probe issues; their safe logs are retained. These required no application or private-input fixes. Final screenshots wait for artwork to settle.

## Paired parity evidence

The harness compares the ordinary private provider and the public candidate with copied private packs. It normalizes object-key order and only the timing fields explicitly excluded by the harness. Task order and other meaningful array order remain significant. Time is frozen at the captured save's latest progress observation, following the established dataset-parity convention. No save is pre-normalized and no progress snapshot is omitted. This proves unchanged startup bytes at that observation; ordinary real-time startup may legitimately record a new daily observation. Each paired child receives the same fresh random seed; the seed is never stored in gameplay files.

Authentication and operational sidecars are excluded from gameplay-byte equality. Their permissions and behavior have separate checks. Synthetic tests and disposable copied-save checks do not establish Player 2's actual hosted-device reachability.

| Count | Private app | Public core with packs |
| --- | ---: | ---: |
| First member: tasks / blocked tasks | 20,641 / 18,944 | 20,641 / 18,944 |
| First member: eligible / excluded rolls | 3 / 1 | 3 / 1 |
| Second member: tasks / blocked tasks | 20,593 / 18,904 | 20,593 / 18,904 |
| Second member: eligible / excluded rolls | 20 / 1 | 20 / 1 |
| Explicit art routes checked | 111 | 111 |
| Resulting gameplay files compared | 147 | 147 |

| Workflow or boundary | Result and evidence |
| --- | --- |
| Read-only startup: save bytes, revision and no new migration | Unchanged in both profiles; complete gameplay-file hashes compared |
| Both members: task IDs, status, order, blocked reasons and roll pools | All hashes and counts equal |
| Transport and training | Both teleport results and Mining/Woodcutting/Fishing plans equal; requests leave saves unchanged |
| Roll, complete, History and Undo | Results, intermediate saves and History equal; both Undos restore gameplay |
| Member writes and denial of other protected operations | Own-note command and Undo succeed; protected other-member operation and admin restore refused |
| JSON/gzip backup export, preview, restore and stale revision | JSON/gzip content equal; mutate a note after export, restore it to the exported value; stale revision refused |
| Installed art: authenticated GET, HEAD and 304 behavior | All 111 bound routes equal; member/viewer representative GET/HEAD/304 succeed; unauthenticated access refused |
| Administrator, member, viewer and revoked invitations | Fresh roles behave correctly; revoked join and existing session refused, including after restore |
| Narrow overlay access and write permissions | Count payload has only permitted fields; other scope/widget, app data/art and commands refused; revocation survives restore |
| Desktop and phone workflows/layouts | Roll, personal completion, reload, History, Undo, backup/settings, switching and viewer checks pass at 1440 and 390 px |
| Final disposable-copy cleanup | Passed; live storage and original packs were never opened for writing |

The [expanded parity receipt](../../.local/m6shadow/shadow-parity.json) and [log](../../.local/m6shadow/shadow-expanded-run.log) retain all 48 comparisons. An earlier 37-comparison pass is retained separately; review strengthened restore by changing content between export and import and added transport/training and post-restore revocation checks.

Final captures: [desktop 1440](../../.local/screens/m6shadow/shadow-1440.png), [phone 390](../../.local/screens/m6shadow/shadow-390.png), and [viewer 390](../../.local/screens/m6shadow/viewer-390.png). The [final browser report](../../.local/screens/m6shadow/browser-report.json) records 477 image responses, zero renderer/console errors and zero outside requests. Gallery logs and its successful combined session remain beside it. All captures remain private.

## M7 cutover procedure, not executed

M7 must create the new public source checkout, retain the existing immutable private pack selections, install the pinned private descriptor, and use a separate operator launcher. `Start-Picker.ps1` derives its root and storage paths, so moving that launcher without explicit configuration could open a different game. Prepare matching start/stop helpers that verify the new code path, existing data directory, exact PID and creation time. Update the everyday startup entrypoint to that pair; retain the old pair for rollback.

Before switching, read the actual deployed configuration and keep `C:/Users/User/Projects/chunk-picker-rs3/.local/duo` as the absolute data directory, with its existing sibling `duo.dataset.json` binding. Keep the original parent's `public-origin`, `backup-destination`, `backup-status.json`/backup log and existing scheduled backup configuration. Preserve retention/runtime options too. Take a secured full snapshot with the writer stopped. Include the access token, invitations, sessions and revocations, overlays, journals, static state, archived History and backups. Ordinary gameplay exports omit credentials and cannot replace this operational snapshot.

Preserve the current host and port 8788, optional loopback port 8789 if configured, the exact saved `RS3_PUBLIC_ORIGIN`, and the Tailscale Funnel proxy/cookie origin configuration. Read these actual values at cutover; do not change DNS, proxy targets or links. Start the new checkout's `app/server.mjs` with explicit `--data-dir`, `--host`, `--port` and the existing `--loopback-port` when applicable. Select `RS3_DATASET=duo-legacy`, `RS3_PACKS_DIR` pointing to the existing main-checkout packs, the exact pinned selection, and `RS3_DATASET_PROFILE`/`RS3_DATASET_PROFILE_SHA256` before imports. Retain art overrides only after checking their bytes against the selected packs. Do not use the independent npm launcher or a disposable verification preload for deployment.

Stop the old verified writer and confirm its lock is released before starting the new writer. Reuse storage, credentials and invitations. Do not recreate the game, regenerate the master credential, issue replacement links or change member identities. Before reopening writes, check both members' tasks/pools, installed art, health, existing administrator/member/viewer sessions and overlays. Player 2 keeps opening his existing hosted invitation and installs nothing. Same origin plus the unchanged credential/session sidecars preserves his access. His actual remote-device connection must be checked at M7; M6 local checks do not establish it.

After acceptance, keep one public shared-code source and stop application mirroring. Private inputs, packs and integration checks remain private. M7 has not been executed by this work.

If rollback is needed, stop the new process and release its storage lock before restarting the previous code/launcher with the same selected packs, network configuration and compatible storage. Preserve accepted progress made after cutover. If storage compatibility prevents direct rollback, retain a post-cutover snapshot and reconcile accepted commands before restoring the secured snapshot. Never automatically overwrite new gameplay, credentials or invitation revocations.

The deliberate limits are the three utility omissions above, the two documented optional inputs and Player 2's untested real hosted-device connection. No live picker switch, remote, push or publication occurred. The cutover and rollback instructions remain a plan.
