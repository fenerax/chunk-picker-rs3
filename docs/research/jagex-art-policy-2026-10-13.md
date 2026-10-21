# Jagex artwork in a free, open-source RS3 picker

**Recommendation: open-source the authored code separately, and ask Jagex for written permission before publishing the Jagex artwork.** Being free and non-commercial helps, but the public policies do not clearly authorize this external software tool, its bundled images, or redistribution by its users. Keeping the art is a realistic permission request, not an established right. Runtime downloads and user-side cache generation change who makes and distributes copies; neither establishes permission by itself.

This is research, not legal advice. Confidence is high about the published wording and observed repository practices, medium about how Jagex would apply them to this picker, and low about unpublished agreements. A schematic map and independently drawn generic icons offer a publication path while the permission question remains open. The existing private deployment was not changed or declared legally cleared by this report.

Checked **13 October 2026**. Read [the readiness report's third-party rights section](open-source-readiness-2026-10-13.md#third-party-rights) first. Local inventory is from `codex/jagexpolicy`, starting commit `c16a4c27dcecb4fe0c928e08ee7fac3de634f873`. Sources and distinctions below refine that report; they do not remove its separate upstream-picker, Wiki-data or privacy blockers.

## Assets and proposed distribution

“With permission” below means permission covering this external picker, the named files, acquisition method, modifications and intended distribution. The least exposed option before that permission is an independently authored substitute or omission. An optional private asset directory is useful packaging, but should not be advertised as a legally approved workaround.

| Asset type | Current location in this repo | Safest distribution option | Attribution needed if retained |
| --- | --- | --- | --- |
| World/chunk map images | `resources/chunk_images/` (2,350 tracked files); `reference/original-picker/runescape_world_map.png`; world-image route in `app/server.mjs:1896` | Publish an authored schematic first. With permission, distribute the approved crop/tiles in a separately labelled asset package or use an expressly approved download source. | Jagex notice; source/renderer and changes; Source Chunk credit where its arrangement or crop is retained. |
| Interior/section overlay images | `resources/section_overlays/` (775 files); local rendered interiors are described by `app/data/cache-interiors.2026-10-08.v2.json` and `app/data/interior-assets.mjs` | Omit copied interiors pending permission; independently drawn diagrams where practical. Local cache renders require extraction permission too. | Jagex notice; renderer/version and modifications; any upstream contributor whose protected work is retained. |
| Equipment and item inventory art | `resources/equipment_icons/` (4,134 files); two copies in `app/web/task-item-artwork.2026-10-09.v1/`; bindings in `app/web/task-artwork.mjs` | Authored symbols/text first. With permission, a narrow, versioned icon pack or approved per-file retrieval rather than all 4,134 images. | Jagex notice; per-file source and Wiki file/revision if sourced there; upstream credit separately. |
| Skill and related SVG icons | `resources/SVG/rs3/`, `resources/SVG/osrs/` (64 files combined) | Replace with independently designed symbols unless each file's rights are established. Vector conversion or tracing is not evidence of independence. | Jagex notice where derivative; identify SVG creator/source and applicable additional licence. |
| Treasure Trail clue maps | `resources/clue_maps/` (24 files) | Text/coordinates or authored diagrams first; approved images only after permission. A recreated illustration of a game clue may still be derivative. | Jagex notice plus actual file/source provenance; author/licence for added annotations. |
| Cursors | `resources/cursors/` (15 files) | Use standard platform cursors or authored generic cursors. | Jagex notice for game-derived cursors; source and changes. |
| Favicons and retained reference graphics | `resources/favicons/` (10 files); six PNG/PNG-named reference images, including world, avatar, background and blank images; `app/web/favicon.svg` | Review provenance individually. Publish a clearly authored picker identity; omit reference screenshots and game-derived avatars. Some blank/background graphics may be upstream-authored, rather than Jagex-owned. | Credit the actual creator; Jagex notice only where game art is present. Upstream permission remains separate. |
| Community terrain and pin imagery | Installation convention `.local/map-assets/`; `docs/map-assets.md`; importer `scripts/import-map-assets.mjs` | Do not bundle community tiles or automate their retrieval as an approved release path until both Jagex and contributor rights are settled. | Jagex notice, mejrs credit, pinned repository commit, per-icon Wiki file/revision and changes. |
| Cache-generated surface/interior terrain, optimized WebP pages, sprite/item/skill PNGs | Ignored local asset roots selected by `RS3_MAP_ASSETS_DIR`, `RS3_TERRAIN_ASSETS_DIR`, `RS3_ICON_ASSETS_DIR`; descriptors in `app/data/terrain-assets.mjs`, `app/data/skill-icons.2026-10-08.v1.json`, `app/data/item-icons.2026-10-*.json` | Keep outside public Git/releases. Local import is an option only after its acquisition/use terms are clarified. Do not ship raw cache as a fallback. | Jagex notice; decoder/renderer attribution under its actual licence; source build/hash and edits. |
| Cache-derived catalogues, topology, coordinates and labels | `app/data/cache-*.json`, `app/data/map-*.json`, `archive/data/`; raw inputs normally `.local/game-data/` | Review independently of image packaging. Publish only independently established facts or datasets with an established right to distribute; do not assume a JSON export is exempt. | Provenance and any Wiki/contributor licence; Jagex acknowledgement where applicable, under the eventual permission. |

The local roots above are configuration conventions, not claims that these bundles are installed in this worktree. No other worktree, original save, game cache or live picker was opened. Counts identify tracked locations, not a file-by-file ownership ruling. Font Awesome has separate documented licences and is outside the Jagex question.

## 1. Fan Content Policy

The fetched [Fan Content Policy](https://legal.jagex.com/docs/policies/fan-content-policy) identifies **version 1.3, 30 June 2025**; fetched 2026-10-13. Clause references and short excerpts:

| Subject | Clauses | Finding |
| --- | --- | --- |
| Scope | 2.1–2.5 | Game visuals covered; “source code” excluded; trademarks excluded. |
| Free use | 3.1.4, 6.1.1 | “non-commercial”; personal use, with specified exceptions. |
| Redistribution | 3.1.2, 3.1.5, 4.2 | “non-transferable”, “non-sublicensable”; compliant creations may be posted/linked. |
| Changes | 3.1, 4.1.3, 4.1.6 | Derivative works permitted within scope; mod exception is Dragonwilds-only. |
| Software | 6.1.2–6.1.3 | Reverse engineering/unauthorized clients restricted; heading includes “Software or Application”. |
| Other prohibitions | 4.3, 5.3, 6.1.4–6.1.7 | NFTs, specified sales, competing, offensive, misleading and merchandise uses restricted. |
| Credit | 8.1 | Prominent prescribed attribution/disclaimer. |
| Withdrawal | 3.1.3, 9, 11.1–11.3 | “revocable” at any time, for any reason; takedown/escalation and updates possible. |
| Distribution consequence | 7.2 | Creations also license broad rights to Jagex. |

**Ambiguity:** 6.1.3's heading reaches software broadly; its operative examples concern video-game content, add-ons and servers. Existing third-party clients are mentioned in 6.1.2; external planners/fan tools are not expressly addressed. That mismatch prevents a confident blanket prohibition or permission conclusion. Clauses 4.1 and 14 leave decisions/separate agreements with Jagex. [Policy](https://legal.jagex.com/docs/policies/fan-content-policy).

For this picker, cropping, recolouring, converting PNG to SVG/WebP, or placing an icon beside authored text does not establish a new independent asset right. “Open-source code” and “reusable artwork” must have separate licence scopes. Fork authors cannot simply inherit an asset licence from the picker maintainer; determine whether they can rely on the policy independently or need the written grant. These are release-design conclusions, not a ruling about a statutory exception.

## 2. General terms, extraction and the October plugin platform

### General terms and EULA

[Terms and Conditions, section 7](https://legal.jagex.com/docs/terms/terms-and-conditions), fetched 2026-10-13, reserves rights over game data, graphics and other materials. Its permission is limited, personal, non-commercial and revocable; it also restricts replacement clients/server emulators. A right to play or possess a downloaded cache does not establish a right to publish its contents. This page did not display a version/date comparable to the fan policy; the fetch date is not its effective date.

The fetched [EULA](https://legal.jagex.com/docs/terms/eula) lists **version 8.0, June 2025**. Relevant provisions:

| Clause | Relevance |
| --- | --- |
| 1.1 | Personal, non-commercial use licence. |
| 2.1(a), (f) | Copying, decoding-related reverse engineering and derivative-work restrictions; normal-use copying exception in (a), mandatory-law exception in (f). |
| 2.1(b) | Restricts publication/distribution of Software, including parts. |
| 2.1(c)–(e), 2.2–2.3 | Restricts modification, combination with third-party programs and enabling restricted uses. |
| 2.1(g) | Restricts bypassing security/technical measures. |
| 3.1–3.4 | Artwork and landscape rights remain with Jagex/licensors; its Software is not made open-source. |
| Schedules 1–3 | Specific Melvor Idle, Dragonwilds and authorized server-hosting exceptions; not a general RS3 cache-export licence. |

The EULA does not provide a named RS3 cache-extraction allowance. Parsing asset formats is technically different from decompiling executable code, but the ownership, copying and derivative-work provisions also matter. Whether a particular offline decoder falls within an enforceable restriction or a statutory exception needs jurisdiction-specific advice. This report establishes no such exception. [EULA](https://legal.jagex.com/docs/terms/eula).

The [Rules of RuneScape](https://legal.jagex.com/docs/rules/rules-of-runescape), under “Macroing and third-party software/hardware”, also restrict game-world communications, modified code, automation and excessive website requests. A consented, bounded image download is a different operation from a custom cache-protocol downloader or client integration. Do not treat them as interchangeable because they all retrieve data.

### Official RS3 plugin beta: real, but a narrower authorization

Jagex's [6 October 2026 beta announcement](https://secure.runescape.com/m=news/api-plugin-hub-beta-out-now) confirms five selected plugins on a beta environment. It says the API is not public yet and targets late October for public development. Planning/tracking based on visible, known or API-exposed information is within its principles; automation, hidden information, bypassing player execution and deceptive behaviour are outside them. HTTP access requires user permission; plugins require moderation. Documentation, requirements, review details and the AI policy are forthcoming.

**No public RS3 plugin/developer agreement granting external asset redistribution was found by this cutoff.** Checked the launch article and links, June/September announcements, the [legal documentation index](https://legal.jagex.com/llms.txt), Terms, EULA and bounded searches of official domains. The index contained no plugin/API/developer entry. This does not establish that selected developers lack private/NDA terms. June's [API Project Check-In](https://secure.runescape.com/m=news/api-project-check-in) describes the initial NDA group.

For this project, three permissions must be kept separate: using an approved API inside the client; exporting information to an external picker; and copying/redistributing artwork with that picker. Inference: the official plugin programme supports a future companion integration, but provides no demonstrated public grant for a GitHub icon pack. Existing website APIs such as RuneMetrics/Grand Exchange likewise should not be assumed to license every game asset just because an endpoint is reachable. Recheck actual SDK/API terms when released and ask specifically about exports and icons.

## 3. Does the distribution method change the answer?

Yes, it changes the acts and people involved, storage, and practical exposure. It does not change who owns the original artwork. The comparisons below are this report's application of the cited policies, rather than a Jagex-approved ranking.

| Method | What changes | Remaining permission question | Release recommendation |
| --- | --- | --- | --- |
| **(a) Art committed to public Git** | Maintainer makes public copies; clones, forks, source ZIPs and possibly package/release mirrors reproduce them. Later deleting HEAD leaves historical copies. | May this software bundle distribute those files, and may downstream maintainers redistribute them? A code licence cannot grant Jagex rights. | Strongest need for express written redistribution scope. Keep out of initial public tree/history pending it. |
| **(b1) Browser downloads directly from an official site** | Maintainer may distribute URLs/code rather than image bytes; user/browser obtains a copy. Hotlinking still displays the art in software. | Does the specific endpoint permit this use, caching and embedding? Does it support an external tool rather than merely ordinary website viewing? | Prefer an expressly permitted API/media source with bounded requests, local caching and clear notices. Public URL availability alone is insufficient. |
| **(b2) User downloads from the Wiki** | Avoids a maintainer-hosted image archive. User retrieves a file the Wiki is allowed to host. | Is that file reusable elsewhere? Does Jagex's grant to the Wiki extend to this tool? Is there a separate contributor licence? | Fetch file description, revision and licence metadata; use only files whose rights support this use. No automatic blanket Wiki-image importer as a rights solution. |
| **(b3) Picker server downloads, caches and serves images** | Public Git can remain asset-free, but the server operator hosts and supplies copies to users. | Same asset/use rights, plus caching and onward serving. | A hosted download proxy is not equivalent to direct user retrieval. Include hosted service, invitations and cached copies in the request. |
| **(c) User generates images from their own local cache** | Maintainer distributes extraction instructions/code; user produces local copies. No asset bytes need travel through public Git. | Does extraction/rendering and use by third-party software comply with EULA/game rules? The cache is licensed, not owned. Encouraging restricted acts can matter under EULA 2.1. | Reduces maintainer asset redistribution, but leaves a distinct extraction problem. Do not describe it as the safest lawful option without clarification. |

For any approved runtime method, practical controls would include a deliberate import action, identifiable user agent, rate limits/backoff, pinned source/revision and hashes, per-file notices, and no automatic re-download on every page view. The current manual importer already documents several of these controls in [map-assets.md](../map-assets.md). They address reliability and host load; they do not supply copyright permission. Strict CSP, authentication and Undo behaviour are separate app requirements and need not change for this research.

## 4. RuneScape Wiki images

The [Weird Gloop licensing page](https://meta.weirdgloop.org/w/Licensing), fetched directly on 2026-10-13, explicitly separates non-text media from text licensing and directs users to each file description. RS Wiki text is generally CC BY-NC-SA 3.0 for post-fork revisions, with earlier/other exceptions. That licence should not be copied onto an icon pack.

More decisively, the Wiki's [Images and media policy, Copyrights](https://runescape.wiki/w/RuneScape:Images_and_media_policy#Copyrights) says Jagex-IP media, including edited and extracted files, belongs to Jagex; the Wiki uses it with permission, and reuse elsewhere may lack permission. Its “Source” section allows properly tagged cache/extracted images on the Wiki. **That is the Wiki's publication practice, not a grant to every downloader.**

Representative live file checks:

| File or template | Observed file description | Implication |
| --- | --- | --- |
| [Attack-icon.png](https://runescape.wiki/w/File:Attack-icon.png) | `Sprite license`, sprite ID 197. | Jagex game sprite; not automatically CC-licensed. |
| [Bronze sword.png](https://runescape.wiki/w/File:Bronze_sword.png) | `Inventory license`, item ID 1277. | Inventory template ultimately uses the general game-media copyright notice. |
| [RuneScape Worldmap.png](https://runescape.wiki/w/File:RuneScape_Worldmap.png) | `Map license`, Gielinor. | Map wrapper ultimately uses the same general game-media notice. |
| [Wizards' Tower clue map](https://runescape.wiki/w/File:Clue_scroll_(easy)_-_Wizards%27_Tower_map.png) | Raw description had a category and no explicit licence template. | Missing template is unresolved provenance, not public domain. The overall Jagex-media rule remains relevant. |

Checked [Sprite license](https://runescape.wiki/w/Template:Sprite_license), [Inventory license](https://runescape.wiki/w/Template:Inventory_license), [Map license](https://runescape.wiki/w/Template:Map_license) and their shared [License template](https://runescape.wiki/w/Template:License). The shared notice identifies Jagex ownership and permission for use; it does not give this picker a named reuse licence.

A contributor-created diagram, annotation or generic symbol may have its own CC/public-domain licence. Verify creator, file history, source and actual licence; preserve attribution and modification notes. Where a diagram incorporates game art, contributor licensing does not establish permission for the underlying art. For authorized Wiki material, a notice can identify the file/page, revision, contributors, applicable licence URL and edits. Jagex credit and Wiki contributor credit answer different questions.

## 5. What the named projects actually do

### RuneLite: runtime cache use and some committed icons

[RuneLite](https://github.com/runelite/runelite) has a BSD-2-Clause code licence. Inspected commit `5ac57c9d9dc3f47efc9d98d1cad25753e7c82f03` (2026-10-13). [SpriteManager](https://github.com/runelite/runelite/blob/5ac57c9d9dc3f47efc9d98d1cad25753e7c82f03/runelite-client/src/main/java/net/runelite/client/game/SpriteManager.java) reads sprite archives through the running client and caches rendered images. [ItemManager](https://github.com/runelite/runelite/blob/5ac57c9d9dc3f47efc9d98d1cad25753e7c82f03/runelite-client/src/main/java/net/runelite/client/game/ItemManager.java) uses client item-sprite rendering. Its `cache/` module provides cache-reading/writing tooling; the inspected tree did not contain a complete `.jcache`/`.dat2` game cache.

It also commits images: [SkillIconManager](https://github.com/runelite/runelite/blob/5ac57c9d9dc3f47efc9d98d1cad25753e7c82f03/runelite-client/src/main/java/net/runelite/client/game/SkillIconManager.java) loads bundled `skill_icons`/`skill_icons_small` PNGs. Thus “RuneLite never commits game icons” is wrong. Its BSD licence is not evidence that Jagex icons become BSD assets.

**Action and approval are both documented.** Jagex's [16 May 2018 statement](https://secure.runescape.com/m=news/third-party-client-update?oldschool=1) requested closure over IP/game-integrity concerns, specifically deobfuscation tools and republished client code, then temporarily held off legal action after agreement to close those sources. [RuneLite's response](https://runelite.net/blog/show/2018-05-16-Update-RuneLite-threatened-to-shutdown/) reports removing the tools/client from GitHub. Jagex's [17 June 2022 update](https://secure.runescape.com/m=news/third-party-clients-update?oldschool=1) explicitly lists RuneLite as approved and integrated with its launcher; the linked [client guidelines](https://secure.runescape.com/m=news/third-party-client-guidelines?oldschool=1) regulate features. This is strong OSRS client precedent, not transferable RS3 asset permission.

### Alt1 and RS3 apps

[Alt1](https://runeapps.org/alt1) is an external screen-reading/overlay toolkit, not a replacement game client. Its [help](https://runeapps.org/alt1/help) describes web apps and per-app permissions. The public [skillbert/alt1 library](https://github.com/skillbert/alt1/tree/02bf42fb9ec4296a532edbdb619082d8a854ed1d), inspected at `02bf42fb9ec4296a532edbdb619082d8a854ed1d`, commits 146 PNG files, including small game-interface recognition images. Its image loader packages pixel data for recognition. This is a concrete example of shipping image samples alongside tool code; it does not establish a blanket licence for every Alt1 app's art. No repository-wide licence text was found in the inspected library tree or licence declaration in its package metadata.

The [Wiki's Alt1 account](https://runescape.wiki/w/Alt1_Toolkit) records Mod Infinity's initial 8 October 2015 objection and subsequent 15 October acceptance after anti-cheating review, subject to rules and user risk. The [original comment](https://www.reddit.com/r/runescape/comments/3ootg2/alt1_toolkit_guide/cw0ijyk/) could not be independently retrieved in this run. Treat this as attributed historical account-use acceptance, not current written asset redistribution approval. The [author's 2018 forum explanation](https://runeapps.org/forums/viewtopic.php?id=644) is the author's compliance claim. No asset-related takedown against the base toolkit was established by these bounded checks; app-specific agreements/actions remain unknown.

### mejrs layers/data

[layers_rs3](https://github.com/mejrs/layers_rs3/tree/f1e12f444ddb0f7e594d9e213dd2758cb377cc46) publicly hosts map/icon raster layers; [data_rs3](https://github.com/mejrs/data_rs3/tree/b8424a43d8370adc71de53f7d6438ad0f77d0944) hosts JSON including sprite placements, labels and locations. These are the picker's existing pinned sources, confirmed by root listings. Current GitHub metadata detected no licence; neither pinned root included a licence file. No affirmative asset grant was found. This root check does not rule out a notice elsewhere in their large histories.

Their existence demonstrates public hosting, but provides no independent basis for this project's mirroring rights. Contributor rights in code, annotations, arrangement and data selection may add another permission layer. No Jagex approval agreement or enforcement action for these particular repositories was found in bounded searches; that is an evidence gap, not a clearance.

### skillbert/rsmv and cache tools

[rsmv's README](https://github.com/skillbert/rsmv/blob/a92b8920b9b9842adde78822646ecad1a6f4fc15/readme.md) documents downloading cache from game servers and opening local NXT cache, then decoding/extracting data and models. Its copyright section says Jagex is generally aware of cache tools used by the Wiki and asks users not to publish leaks/unreleased content. **This is the maintainer's statement, not a Jagex permission letter.** The inspected tree had five generic viewer PNG assets, not a full raw game cache.

At the picker's pinned commit `a92b8920b9b9842adde78822646ecad1a6f4fc15`, [package.json](https://github.com/skillbert/rsmv/blob/a92b8920b9b9842adde78822646ecad1a6f4fc15/package.json) declares `GPL-4`, while no licence text was found in the complete tree. This is unresolved licence metadata; do not silently interpret it as GPL-3.0 or MIT. Ask the author before vendoring source. Tool-code permission and rights to decoded Jagex output remain separate. No primary evidence of a Jagex-specific rsmv approval or takedown was found.

### The Wiki's maps

The live [cartography documentation](https://runescape.wiki/w/RuneScape:Map) describes RS3 map generation from game cache and links the mejrs development map. It distinguishes background rendering, icons, labels and user-authored features. [The world-map file](https://runescape.wiki/w/File:RuneScape_Worldmap.png) uses the game-media map licence wrapper. The [Wiki media policy](https://runescape.wiki/w/RuneScape:Images_and_media_policy#Copyrights) expressly reports permission from Jagex for its use. These facts support the possibility of an agreed fan-map use, while the Wiki's warning against assuming outside reuse directly limits the precedent. No public agreement text was found extending that permission to the picker.

## 6. Attribution and disclaimer to use

**Use the complete two-sentence notice from Fan Content Policy clause 8.1 verbatim, prominently, if Jagex confirms this use is covered.** The disclaimer sentence is:

> This content is not endorsed by or affiliated with Jagex.

The full required attribution plus disclaimer is 26 words. It is available in [clause 8.1](https://legal.jagex.com/docs/policies/fan-content-policy#id-8----do-i-need-to-give-jagex-credit) and in the [exact notice fetched into this worktree](../../.local/jagex-clause-8.1-notice.txt). The local text is an ignored source extract, not a committed licence grant. This report uses short quotations; the following bounded command retrieves the complete exact wording directly, rather than substituting a paraphrase for the mandatory notice:

```powershell
$uri = 'https://legal.jagex.com/docs/policies/fan-content-policy.md'
$policyText = [string](Invoke-WebRequest -Uri $uri -TimeoutSec 25).Content
$creditSection = [regex]::Match($policyText, '(?s)### 8\..*?(?=### 9\.)').Value
$creditNotice = [regex]::Match($creditSection, '(?m)^\*([^\r\n]+)\*\r?$').Groups[1].Value
if (-not $creditNotice) { throw 'Clause 8.1 notice could not be located; inspect the policy.' }
$creditNotice
```

Put the full notice in public README/third-party notices and a visible About/Map sources area near use of the assets. Add a link to the policy. A future separate agreement may prescribe different or additional wording; follow that agreement. The notice alone does not authorize a restricted use or make the policy's scope certain.

Suggested **additional project licence boundary**, authored for this picker:

> The project code licence covers only the code and assets identified as authored by this project. RuneScape artwork and game-derived assets remain subject to their owners' rights and any separate permission stated in the asset manifest. The project code licence grants no permission to reuse those assets. Third-party notices identify their sources and applicable terms.

For a Wiki-sourced file, use a file-specific template, filled with real values:

> [Asset name] was obtained from [linked Wiki File page, revision and retrieval date]. Game artwork belongs to Jagex Limited. [Contributor name] created [the independently authored addition], used under [actual licence and link]. This project changed [crop, size, format or annotation].

Do not fill in CC BY-NC-SA solely because a Wiki footer displays it. Where there is no independently authored addition, remove that sentence. An upstream credit or this suggested notice is not an alternative to the required Jagex notice.

## 7. Asking Jagex and deciding the release

The policy identifies **IP@Jagex.com** for uncertainty (16.1) and takedown disputes (12.1). Clause 14 provides a [commercial licensing form](https://survey.alchemer.eu/s3/90924648/Jagex-Commercial-Licence-Application-Form) and separate-agreement route for out-of-scope activity. [Contact source](https://legal.jagex.com/docs/policies/fan-content-policy). The IP address is the appropriate first route for this free project. No message was sent.

Send a compact permission request, with this report's inventory attached or summarized. Include the external planner's purpose, a public-safe screenshot/mock-up, a representative exact asset list and sources, proposed code licence, free/non-commercial operation, and the intended public hosting/download model. State whether there will be donations, ads, paid hosting or sponsorship; do not assume “free download” answers those questions. Describe what the app actually does without promising that hypothetical future integrations are already approved.

Ask for an explicit answer to each of these points:

1. Does clause 6.1.3 permit this external RS3 planning/tracking tool, despite its software heading? If not, can Jagex grant a written exception?
2. May its named map tiles, inventory/skill icons and clue images be copied into public Git, source ZIPs, binaries and hosted deployments?
3. May users redistribute the art with forks and modified copies, under a separate asset notice, while the authored code uses MIT or another permissive licence?
4. Are cropping, scaling, recolouring for map visibility and PNG/SVG/WebP conversions allowed?
5. Which acquisition method is permitted: specified official endpoints, Wiki files, community renders, or decoding a user's local NXT cache? Does permission cover distributing the importer/decoder instructions?
6. What attribution, trademarks, review process, revocation/takedown conditions and geographic or duration limits apply? Does approval cover existing files or only future approved packs?
7. Does any official plugin permission extend to exporting artwork or game data to this external app, and on what conditions?

Suggested request body:

> Subject: Permission request for artwork in a free RS3 chunk-planning fan tool
>
> I maintain an independent RuneScape 3 chunk-planning and progress tracker. I would like to publish its authored source code under a permissive software licence and keep selected RuneScape map images, item/skill icons and clue maps in the tool. The release would be free and non-commercial. I can provide a representative asset inventory, source links and screenshots without player information.
>
> Please confirm whether the external tool is covered by your Fan Content Policy, particularly clause 6.1.3. If a separate agreement is needed, could you authorize the listed artwork's use, approved acquisition method, limited image edits, public repository/release distribution, hosted display, and redistribution with community forks? Game assets would remain outside the code licence and carry your required attribution and disclaimer. I would also like to clarify local-cache extraction and any approved runtime-download option.
>
> Please identify the permitted scope and any conditions or exclusions in writing. I will distinguish any plugin/API integration from permission to distribute game art, and follow the notice and takedown terms you specify.

Fill in actual monetization and distribution plans before sending. Prefer an answer from the IP/legal team or an identifiable authorized representative; an account-safety comment or silence is insufficient evidence of a redistribution grant. Also obtain the upstream picker/mejrs/decoder/contributor permissions that Jagex cannot grant on their behalf.

**Release decision:** preserve the current private artwork while reviewing permission; prepare an asset-free public code tree with generic replacements; seek written permission to retain the desired art. If approved, attach the agreement/reference and per-file provenance to a separately scoped asset package, then check forks, releases and hosting against that scope. If declined or unanswered, publish the authored code and substitutes. Moving copied art into a download script or cache exporter should not be the default response to missing permission.

## Evidence limits and verification

Research used bounded public-page searches/fetches of Jagex policy/news, the Wiki/Weird Gloop, and the named project repositories/sites required by the brief. No crawling, bulk art download or game-server cache connection occurred. Web-tool Wiki robots denials were followed by direct `Invoke-WebRequest` retrieval of public raw descriptions/templates. Live raw cartography documentation differed from an older web-tool snapshot; the live version was used. GitHub root listings/complete trees were inspected where stated; the large mejrs layer repositories were not recursively downloaded. No private agreements, general history of all enforcement, every Alt1 app or every image's history were audited.

The exact clause 8.1 extraction command was checked against the fetched Markdown and returned a nonempty 26-word notice. `npm run test:quick` passed **1,218 tests**, zero failures/cancellations/skips, on Node **24.20.0**. `git diff --check` passed. This docs-only change adds no test files and changes no app behaviour. Full suite, browser sessions and 1440/390 px screenshots were deliberately skipped; no server or browser was started. All tracked changes are confined to this report; the fetched notice remains ignored under `.local`.
