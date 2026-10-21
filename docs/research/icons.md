# Skill and item icons

## October 9 task lookup and tier supplement

The compact catalogue now uses `/assets/map/icons.2026-10-09.v1.json` and retains the immutable October 8 skill and item folders. `app/data/item-icons.2026-10-09.v1.json` adds **63 names**, **63 inventory PNGs**, and **41,602 bytes** in a separate `icons-items.2026-10-09.v1` folder. The original manifests and PNGs remain unchanged.

All nine tiers (10–90) of **Skull lantern**, **Death guard**, and the five **Deathwarden** armour slots were absent from the old manifest. Their Wiki article titles include the tier, but the inventory infobox `name` is the short family name. The bounded supplemental exporter requires the exact tier-qualified article title, its expected short infobox name, matching explicit bonuses tier, and the same inventory image across every infobox state. It assigns artwork only: it does not claim a cache ID or add an ambiguous bare-family alias. [The pinned binding review](item-icon-review.2026-10-09.v1.json) retains every article revision, state image, bonuses tier, file revision and upload metadata. For example, Skull lantern (tier 10) uses article revision **36962233**, while Death guard (tier 10) uses **36962221**; both quest states agree on each item's own tier-10 PNG. High tiers keep their separate PNGs. Members-only item eligibility still belongs to the task engine.

All **50 Team capes** already had inventory art in the October 8 manifest. Their missing task pictures came from row lookup: an ordinary `Obtain a Team-X cape` label carried neither `equipmentName` nor a Wiki marker. The shared dependency-free `app/tasks/task-icons.mjs` now exposes `taskItemNames(task)` and `taskItemIcon(task, itemIcon)`. It tries explicit equipment/item metadata, all complete `~|item|~` markers, and an anchored `Obtain [a/an/the] item` label. Every candidate must resolve through the same exact catalogue lookup. Unknown tiers, incomplete markers, unknown names and bare tier-family names return no item icon, allowing the UI's existing skill fallback.

`scripts/export-tier-item-icons.mjs` reproduces the supplement from a copied retained Wiki snapshot and direct Wiki file metadata requests. Its default outputs are entirely inside this worktree, and it refuses finalized output manifests or reviews. It never opens a cache database, game client, live picker or private save. Full manifest identity and artwork hashes are independent of the HTTP encoding differences documented below. Focused checks passed **20 tests** covering existing icon behavior, all Team cape row shapes, every supplemental tier name, conflicting names/tiers/state images, pinned review integrity and client/server catalogue agreement. A separate byte audit checked all 63 PNG hashes, byte counts and dimensions and verified that the installed supplement manifest exactly matches the tracked one. The parent integration owns full-suite and representative-save/runtime verification.

This bundle supplies local artwork and name lookups for Activity Info and task lists. It changes no UI placement. Work used `codex/icons` at `5dbd24c`, the copied cache and pinned rsmv in `C:/Users/User/Projects/rs3-cache-work`. The main checkout's tracked files, private duo save, game client, and pickers on ports 8788 and 8790 were not used or changed.

## Skill source and identity

All **29 RS3 skills**, including Archaeology and Necromancy, have native **25×25** small sprites and **52×52** larger sprites. These are cache exports, with their original RGBA pixels and transparent background. No skill artwork comes from a third party.

Copied archive 17 enum **108** maps skill keys 1–29 to names. Enums **371** and **745** map the same keys to small and larger sprite groups in archive **8**. Interface **1213**, components **37–65**, independently binds every small sprite to script **5682** and the corresponding skill key. Archaeology uses groups **10782 / 10785**, and Necromancy **30934 / 30937**.

The skill manifest records enum and interface witnesses, copied database hashes, compressed container and decompressed group hashes, frame IDs, dimensions, PNG hashes and byte counts. Decoder schema/build **950** is an inferred schema version, not an independently verified installed client build. rsmv is pinned to **a92b8920b9b9842adde78822646ecad1a6f4fc15**. Prayer's larger sprite uses a legacy bzip2 JS5 container, decoded with Python's standard `bz2` module; other sprites use the existing cache reader.

## Item scope and source

The extractor collects equipment names, explicit task item requirements, item outputs and rewards, BiS item goals, chunk and section spawns, and named stock for shops referenced by chunks or task unlocks. It expands declarative item selectors through the retained definitions, without treating object outputs or task labels as items. Categories overlap. Unresolved selectors and unmatched requested names remain listed in the item manifest with reasons.

Pinned rsmv was inspected first. Its browser item view uses the inventory camera and cache item rotations/zoom at 36×32. Its exported headless item appearance uses a generic 500×700 model view; the Node WebGL path is unmaintained and the retained terrain runtime supplies no browser/WebGL stack. The importer therefore uses the **RuneScape Wiki item infobox inventory image** fallback. Original PNG dimensions are preserved; clients can contain them within a 32px box.

Reviewed equipment identities from [cache-equipment-corrections.md](cache-equipment-corrections.md) select the exact cache ID and Wiki infobox variant. Other matches require the exact item name. If multiple matching states have different images, the name remains unmatched. A shared image can establish an artwork lookup without choosing an unverified game ID. `Rune platebody` is bound to reviewed cache ID **45543**.

Wiki article and file metadata queries use 40-title batches, a descriptive User-Agent, sequential query pacing and backoff. Image downloads use at most four workers and local checkpoints. Files and image URLs are deduplicated. Per-file provenance includes the Wiki file page, image timestamp, download time, revision, Wiki SHA-1, local SHA-256 and licence note. Runtime lookup and rendering never contact the Wiki.

**Upload and delivery hashes have different scopes.** `wikiSha1` identifies the upload stored by MediaWiki; `downloadSha1` and `sha256` identify the saved HTTP response bytes. A complete comparison found zero dimension differences. Of 8,240 source records, 7,179 have a different delivery encoding; 6,637 of 7,530 unique PNGs differ from at least one corresponding stored upload. A later header-only check of the blueprint URL returned `cf-polished: ok, orig_size=1389` and served length 1,308, matching the saved file. [Cloudflare's Polish documentation](https://developers.cloudflare.com/images/polish/compression/) describes recompression and metadata stripping; [MediaWiki's imageinfo documentation](https://www.mediawiki.org/wiki/API:Imageinfo) defines the stored-upload metadata. The current batch retains representative HEAD evidence; it did not capture optimization headers for every original GET. Encoded-byte differences do not establish pixel differences or certify a particular optimization mode. The saved PNGs retain the Wiki-reported dimensions, and their delivery hashes are independently verified.

## Coverage and local storage

Final coverage and size accounting is recorded in the two versioned manifests. `totalBytes` counts unique PNG bytes, including the larger skill sprites, and excludes manifest JSON. Item category counts overlap and must not be added together.

Skills cover **29/29 names** in both sizes: **58 PNGs, 133,313 bytes (130.2 KiB)**, with no unmatched skills or unavailable larger icons.

The item scope contains **10,918 distinct names**. Of **426 named shops**, **68** lack stock records in the retained source; the manifest lists them under `coverage.shops.withoutStock`. Stock for those shops cannot be added to the requested-name count without inventing names. The runtime cache-resource overlay preserves all retained item spawns and shops, so it adds no further item names to this import.

Items cover **8,240/10,918 names (75.5%)**, all from Wiki inventory PNGs; **zero** use cache model renders. Identity coverage is **2,614 verified cache/Wiki variants** and **5,626 exact-name matches**. There are **7,530 unique item PNGs**, **5,676,104 bytes (5.41 MiB)**. The full item manifest is **13,296,275 bytes**. Combined skill and item asset folders occupy **19,164,464 bytes (18.28 MiB)** including their local provenance manifests.

| Item category | Mapped / requested |
| --- | ---: |
| Equipment | 2,654 / 3,550 |
| Task item requirements | 6,574 / 8,585 |
| Task item outputs and rewards | 5,488 / 7,142 |
| BiS item goals | 351 / 393 |
| Chunk and task-unlocked spawns | 223 / 315 |
| Named shop stock | 1,599 / 2,002 |

The **2,678 unmatched requested names** comprise 869 missing item infoboxes, 770 without an exact item-name variant, 683 ambiguous variant images, 350 multiple-image infoboxes, five files without an inventory licence declaration and one missing file. The manifest also lists **10 excluded selectors** with `requested: false`; these are outside the distinct-name denominator. `Coins` stays unmapped because its infobox combines stack images and a separate 1B-coin identity; a default quantity or variant is not selected.

The immutable local asset folders are:

- `C:/Users/User/Projects/chunk-picker-rs3/.local/map-assets/icons-skills.2026-10-08.v1/`
- `C:/Users/User/Projects/chunk-picker-rs3/.local/map-assets/icons-items.2026-10-08.v1/`

Each contains a full `manifest.json`, identical to its tracked counterpart under `app/data/`. PNGs stay local and are not committed. Existing asset folders were preserved. A future refresh must use a new version and folder.

## Lookup and serving

The existing invitation authentication protects the helper, manifests, lookup API and images. The configured `mapAssetsDir` or `RS3_MAP_ASSETS_DIR` supplies the asset root. To exercise this worktree against these assets, set `RS3_MAP_ASSETS_DIR` to the main checkout's `.local/map-assets`; use a separate synthetic state directory and an ephemeral port. No live server was restarted.

The compact browser manifest is **`/assets/map/icons.2026-10-08.v1.json`**, **959,196 bytes** before compression. Full provenance manifests are served at **`/assets/map/icons-skills.2026-10-08.v1/manifest.json`** and the corresponding items path. Only manifest-listed PNGs and matching installed bundle versions are served. The route checks realpath containment and PNG hashes. Versioned PNGs and complete manifests have `private, max-age=31536000, immutable`; PNGs and the compact manifest support conditional ETag requests and HEAD. Missing or partially installed compact manifests use `no-store`.

The read-only lookup endpoint is:

```text
GET /api/icons?kind=skill&name=Defence
GET /api/icons?kind=item&name=Rune%20platebody
```

It returns `{ kind, name, canonicalName, url }`. Unknown or ambiguous names return `url: null` and `canonicalName: null`. Matching normalizes case, Unicode compatibility characters, and whitespace. Only explicit aliases are accepted. Skill aliases include `Defense`, `Hitpoints`, `Hit points` and `Runecraft`.

`app/web/icons.mjs` exposes synchronous URL-or-null lookups and a shared lazy readiness promise:

```js
import { loadIcons, skillIcon, itemIcon } from './icons.mjs';

await loadIcons(); // Fetches the local manifest once, on first use.
skillIcon('Archaeology'); // Local 25px PNG URL, or null.
itemIcon('Rune platebody'); // Local inventory PNG URL, or null.
```

Calling either lookup first starts the same load and returns `null` while it is pending. Fetch failure stays quiet and is not retried during that page's lifetime. Install complete folders before starting a new server; its catalogue is loaded once on demand. The larger skill PNG paths are listed in the full skill manifest.

## Reproduction and verification

`scripts/export-skill-icons.mjs` exports and verifies copied-cache enum/interface bindings. It requires Node's TypeScript stripping support and Python 3 for the legacy bzip2 sprite. Supply `--workspace`, `--output` and `--manifest`; it refuses existing output folders. `scripts/export-item-icons.mjs` supports explicit reference, reviewed identities, retained Wiki snapshot, scratch checkpoints, asset output and tracked manifest paths. Neither exporter opens original cache databases or a game client.

Tests cover provenance and manifest shape, skill enum/interface identity, item extraction, exact cache/Wiki variant selection, ambiguous and missing names, aliases, optional bundle installation, invitation authentication, caching, HEAD, conditional requests, tampering and path/junction containment. Local PNG verification is opt-in through `SKILL_ICON_ASSET_ROOT`; the final verification also audits every item PNG against its manifest.

Final `npm test` on 2026-10-08 passed **1,196 tests**, including **26 icon tests**, with no failures, cancellations or skips. `SKILL_ICON_ASSET_ROOT` enabled checks against the installed skill PNGs. A separate audit verified all **7,588 unique PNGs** for byte counts, dimensions and saved-byte hashes; compared tracked and installed manifests; checked every mapped name and alias through the client helper; and exercised authentication, HEAD, ETags and cache headers with real assets and synthetic state on an ephemeral port. Local evidence is retained in `.local/npm-test-icons-2026-10-08-final-v2.log`, `.local/icons-runtime-audit-final.log` and `.local/icons-verification.json`.

## Changed files

| Files | Purpose |
| --- | --- |
| `app/data/icons.mjs` | Shared name normalization, catalogue, explicit alias lookup and file allowlist. |
| `app/data/skill-icons.2026-10-08.v1.json`; `app/data/item-icons.2026-10-08.v1.json` | Versioned identities, coverage, unmatched names and per-file provenance. |
| `app/web/icons.mjs` | Lazy browser manifest loading and URL-or-null helpers. |
| `app/server.mjs` | Authenticated local manifests, PNGs, lookup endpoint and caching. |
| `scripts/export-skill-icons.mjs`; `scripts/export-item-icons.mjs` | Copied-cache sprite export and bounded Wiki inventory import. |
| `tests/icons.test.mjs`; `tests/icons-server.test.mjs`; `tests/skill-icons.test.mjs`; `tests/item-icons.test.mjs` | Lookup, route, source and generated-artifact checks. |
| `.gitattributes`; `docs/research/icons.md` | Stable LF provenance files and this report. |

## Artwork rights

Skill sprites and inventory artwork remain copyrighted by **Jagex Ltd.** Wiki text licensing must not be treated as the licence for its game images. Each downloaded inventory image retains its file-page licence declaration and source URL; the Wiki's [licence template documentation](https://runescape.wiki/w/Template:License_templates/doc) distinguishes game media from freely licensed content. [Jagex's Fan Content Policy](https://legal.jagex.com/docs/policies/fan-content-policy) provides the relevant publisher terms. These are local assets for the private picker; this work does not make a redistribution or publication decision.
