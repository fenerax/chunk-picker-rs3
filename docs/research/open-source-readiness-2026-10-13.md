# Open-source readiness, 13 October 2026

**Decision:** prepare a fresh, single-commit public repository after cleanup. Keep this repository and its history private. The authored code is a plausible open-source project; the present checkout is not ready for publication because it contains personal information and third-party material without settled redistribution rights. This job publishes nothing and changes only this report.

## Scope and limits

Audited `codex/ossaudit` at `a686295`, including README, PRODUCT, application, scripts, tests/fixtures, docs, reference, resources and archive. There is no repository `AGENTS.md`. Checked 8,687 tracked paths and scanned 1,227 text files; there were no non-ignored untracked files. This worktree has no local save/game-data/map-assets/screens directory. Other worktrees and the live save were not opened.

History checks used `git log`, `git rev-list --objects HEAD`, `git cat-file` and bounded historical `git grep`. The inventory covers all 471 reachable commits and 12,129 objects. Content scanning covered all 3,730 eligible distinct text blobs of at most 2 MB, totalling 126.1 MB within a 128 MB budget. Larger historical blobs, unreachable objects, other branch histories and image OCR were outside the content scan. Results are evidence of exposure, not a guarantee that every possible secret was detected.

## Current privacy findings

Locations below identify each finding category and important affected surfaces; repeated names and paths have many additional occurrences. Names matched in 295 text files and user-directory paths in 115. Public-source contact details are distinguished from Player 1's information. No secret-looking value is reproduced here.

| Finding | Evidence, file:line | Action before publication |
| --- | --- | --- |
| Real first names and private duo context | `README.md:11`; `PRODUCT.md:3,23`; `DESIGN.md:3`; `app/server.mjs:80`; `app/cli.mjs:47`; `app/storage/store.mjs:682`; `app/web/screen-context.mjs:99` | Replace personal defaults, examples and narrative with generic players. Review repeated test labels, changelog and roadmap text too. |
| Actual RuneScape names and original-picker map identifiers | `app/core/game-progress.mjs:3`; `app/capture-maps.mjs:12`; `app/core/state.mjs:176`; `app/integrations/original-sync.mjs:136`; `docs/runemetrics.md:3,13,14`; `scripts/research/original-parity.mjs:260`; `PRODUCT.md:23` | Remove hard-coded bindings; make capture targets explicit user inputs. |
| Captured gameplay and account progress committed as fixtures | `tests/fixtures/original-sync/capture.json:3,692`; `tests/fixtures/runemetrics/capture.json:3,5`; both account-named `*-profile.json:2` and `*-quests.json:2` in that directory | Replace and rename the captures with synthetic equivalents. Publicly fetchable progress still identifies the players. |
| Synthetic fixtures retain personal attribution | `tests/fixtures/original-sync/local-task-cleanup.json:2,6`; `tests/original-sync-local-fixture.mjs:23`; `tests/state.test.mjs:96,138` | Keep regression scenarios, replace identities and personal wording. |
| Personal save excerpts and planning notes in docs | `docs/reference-comparison.md:7,20`; `docs/research/automatic-travel-real-save-2026-10-09.md:3,5`; `docs/research/switchover-parity-2026-10-08.md:5,39`; `docs/research/plugin-integration.md:98` | Leave private acceptance research out of the public copy; write generic technical documentation. |
| Absolute user/machine paths, including provenance JSON | `PRODUCT.md:69`; `docs/reference-comparison.md:8`; `docs/map-assets.md:29`; `app/data/cache-interiors.2026-10-08.v2.json:39`; `app/data/cache-resources.2026-10-08.v1.json:1`; `archive/data/map-connections.2026-10-08.v3.json:8`; `scripts/cache/game-data-common.mjs:19`; `scripts/build-resource-catalogue.mjs:15`; `tests/cache-resources-catalogue.test.mjs:12`; `tests/skill-guides-extraction.test.mjs:38` | Use relative provenance labels and configurable directories. Recompute affected provenance hashes and tests. |
| Identifying hostname and private Tailscale address | `docs/test-speed.md:3`; `docs/sharing.md:53,55,66,68`; `docs/followup-verification.md:41`; `docs/verification.md:16` | Replace with neutral examples. Funnel examples have a placeholder tailnet but retain the real hostname; no complete live Funnel URL was found. Generic Tailscale subnet constants are harmless. |
| Upstream Firebase API-key-like string and service identifiers | `reference/original-picker/index.html:38–44` | Exclude the historical frontend. This is upstream client configuration, not an identified local administrator secret; do not test it against the service. |
| Email/contact identifiers | `reference/original-picker/index.html:502`; `README.md:88` | Upstream author's public email/contact handle; retain only necessary, agreed attribution. `tests/invites-storage.test.mjs:186` is a synthetic URL-credential rejection case. No personal email found in current file content. |
| Token-like false positives | `app/data/item-icons.2026-10-08.v1.json:64`; `tests/cache-pins.test.mjs:175` | A 32-hex HTTP request ID and a 32-hex encoded sprite fixture, respectively. SHA-256 provenance values are hashes. No literal live invite/admin/overlay token or private key was identified. |
| Screenshots and save links | `docs/research/task-icons-2026-10-12.md:76`; `docs/research/automatic-travel-real-save-2026-10-09.md:412`; `docs/map-ux.2026-10-09.v1.md:52` | Links point to ignored local screenshots, sometimes with identifying paths. No tracked acceptance screenshots found by path inventory; inspect any images chosen for public docs separately. |

`.gitignore:22` excludes root `.local` recursively; `git check-ignore` confirmed save credentials, game-data, map-assets and screenshots are covered. No `.local` paths were tracked now or in the reachable object inventory. Credential/save exclusions also exist at `.gitignore:2–20`. Ignore rules do not remove committed fixtures, documentation or history, and cannot prevent forced additions.

## History and repository choice

The root commit `98a3bdc` already contains the Firebase key-like string at historical `index.html:38` and upstream email at `index.html:502`. Personal fixture introductions are visible in `92c48ea` (original sync) and `bb495ad` (RuneMetrics). `4777eef` introduced hostname/private-address examples in historical `docs/sharing.md:32,34,42,45`. Commit metadata also contains identifying author names and one non-noreply email identity; deleting file contents would leave that metadata.

The object inventory found no saved-store/credential filenames, `.local` trees or screenshot archives, but captured progress exists in fixtures and research. It includes 506.9 MB of distinct uncompressed blob content, including older data versions, a 27.3 MB interior JSON and an 8.1 MB map PNG. Current images alone comprise 7,387 files/25.7 MB. Removing them from HEAD would preserve them in public history.

A fresh repository avoids publishing old personal metadata, removed files and unresolved upstream assets. Preserve credit in NOTICE and provenance rather than copying unsafe history. A rewritten history is possible but requires every revision, author identity, tag and release artifact to be checked; it costs more and brings little benefit for an unpublished project. No history rewrite was performed.

## Third-party rights

Licence pages were checked on the report date using bounded read-only fetches. The Wiki copyright page was fetched directly after the web tool's robots denial.

| Material and current location | Publication assessment |
| --- | --- |
| Original picker by **Source Chunk** (`source-chunk`); README also credits Alyx Bailey for the game mode. `reference/original-picker/README.md:3–17`, root chunk-info export, retained task seed, adapted rule/data catalogues | [Public repository](https://github.com/source-chunk/chunk-picker-rs3) has no detected licence file; GitHub's licence endpoint returned 404. Public visibility grants no general redistribution right. Seek an explicit licence/permission covering code and data, or exclude/recreate them from independently licensed inputs. The new app does not load upstream scripts, but depends on upstream data. |
| Wiki text, tables, modules and derived compilations in `app/data`, `docs/research`, and fishing/mining/woodcutting fixtures | [Copyright page](https://runescape.wiki/w/RuneScape:Copyrights) redirects to [Weird Gloop licensing](https://meta.weirdgloop.org/w/Licensing): normally **CC BY-NC-SA 3.0** for post-fork revisions, with pre-fork/other exceptions. Publish covered adaptations only with attribution, source/revision links, licence notice, non-commercial use and share-alike terms. Verify each source's exception. These terms are not a permissive software licence. Facts alone may differ from copied expression; assess compilations rather than assuming all JSON is unrestricted. |
| Jagex artwork: committed `resources` maps, equipment PNGs, skill SVGs/icons, clue maps, cursors; six retained reference PNGs; two `app/web/task-item-artwork…` PNGs | **Exclude from the initial public code release pending permission.** `app/server.mjs:1896–1900` serves committed art. [Fan Content Policy](https://legal.jagex.com/docs/policies/fan-content-policy), clauses 2, 3 and 6, retains Jagex ownership, excludes game source code and restricts reverse engineering/software uses. It is revocable, non-commercial and non-sublicensable, not an open asset licence. Free distribution alone does not settle this use. |
| Cache-derived catalogues/topology already committed in `app/data` and `archive/data`; raw cache, full exports, generated terrain, pins, sprite/skill/item/interior PNGs in ignored `.local` elsewhere | Keep raw/generated assets outside public Git. Review committed derivatives too. User-side fetch/generation reduces redistribution but does **not** resolve extraction permissions under [Jagex terms](https://legal.jagex.com/docs/terms/terms-and-conditions) and the fan policy. Wiki image licences are file-specific, not automatically its text licence. |
| Community terrain/pins (`mejrs/layers_rs3`, `mejrs/data_rs3`) and pinned external `skillbert/rsmv` decoder/renderer | `docs/map-assets.md:56–60`; `scripts/cache/cache-reader.mjs:55`; `docs/research/cache-terrain-application.md:11,17`. Tool sources execute from an external checkout; rasterizer is external too. Their licences were not fetched under this job's web scope. Verify before bundling tools, copied implementations or generated assets; credits alone do not confer permission. |
| Vendored Font Awesome Free 6.7.2 CSS and six font binaries | `resources/fontawesome/css/fontawesome.css:2–4` states icons **CC BY 4.0**, fonts **SIL OFL 1.1**, code **MIT**. Can retain under those terms with copyright, attribution and licence texts; no standalone LICENSE/NOTICE files found. System Segoe UI fonts are referenced, not bundled (`app/web/style.css:4,67`). No installed runtime dependencies declared in `package.json`. |

## Own-code licence and cleanup order

Recommend **MIT for Player 1's own code**, explicitly excluding third-party data/media and vendored components. MIT is simple and permits commercial reuse; Apache-2.0 adds an explicit patent grant and more notice obligations. GPL requires distributed modified code to remain under GPL, but none of these licences cures missing data/art rights. Keep Wiki adaptations in a separately labelled directory/licence scope, or distribute code without them. The whole present bundle cannot honestly be described as freely reusable open-source content.

Add `LICENSE`, `NOTICE`/`THIRD_PARTY_NOTICES.md`, applicable third-party licence texts and a per-dataset source/revision/licence/changes manifest. Preserve upstream credit, Fonticons copyright and Wiki attribution. Any approved Jagex content needs the exact prominent attribution specified by fan-policy clause 8 and a clear no-endorsement statement.

| Order | Concrete step | Effort |
| --- | --- | --- |
| 1 | Decide upstream permission versus independent data rebuild; resolve Jagex/cache/art publication scope. | Large |
| 2 | Select a public file allowlist; omit private research, reference frontend, archives and unapproved artwork/data. | Medium |
| 3 | Generalize player/account defaults; replace captured fixtures, identifying paths/network examples and personal notes. | Medium |
| 4 | Add licences, notices, source manifests and asset-free setup instructions; update affected hash inventories. | Medium |
| 5 | Make tests portable, with synthetic asset fixtures and explicit optional-data skips. | Medium |
| 6 | Build a fresh repository with chosen public author identity; scan its staged tree and any retained images. Keep private history private. | Small |

## Public CI

Use Node 24 and `npm run test:quick` for the first public job. Full engine/provenance tests currently use **committed** retained game data; `.local` holds additional raw/full data and generated map assets. Excluding committed data requires replacement fixtures or an explicit integration-test split.

| Local-data check | Current behaviour / CI change |
| --- | --- |
| `tests/cache-resources-catalogue.test.mjs:12,72` | Full mask test skips without the private bundle, but object-manifest path is hard-coded. Make both inputs configurable and require the complete set. |
| `tests/skill-guides-extraction.test.mjs:38–39` | Optional export uses `RS3_SKILL_GUIDES_EXPORT`, otherwise a machine path; skips when absent. |
| `tests/skill-icons.test.mjs:83–84` | Real PNG verification requires `SKILL_ICON_ASSET_ROOT`; otherwise skips. |
| `tests/interiors-v2-catalogue.test.mjs:74`; `tests/interiors-v2-server.test.mjs:46,65` | Installed-manifest/tile assertions run conditionally. Report this omitted coverage explicitly. |
| `tests/map-assets-server.test.mjs:80–84` and import/terrain tests | Synthetic assets cover routes/rendering logic without distributing full game artwork. Keep this approach. |

Optional integration CI could fetch permitted, pinned sources with size limits and hash verification, or consume an authorized runner's local assets. Never upload private saves, tokens or raw cache as CI artifacts. Test discovery is classified in `scripts/test-selection.mjs`; preserve that check when splitting suites.

Verification: `npm run test:quick` passed 1,186 tests, with zero failures or skips; `git diff --check` passed. This documentation audit did not start a server or browser, take screenshots, or run the full suite. Publication permissions and portable asset-backed CI remain unresolved work.
