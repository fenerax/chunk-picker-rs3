# Pack release assets

`scripts/packs/publish-assets.mjs` prepares release assets and a proposed CI pin.
Dry run is the default. It runs no GitHub command and never updates the checked-in
`.github/packs/pack-pin.json`.

Use Node 24 with no installed dependencies. Supply all three packs explicitly:

```powershell
node scripts/packs/publish-assets.mjs --tag packs-public-2026-10-21 `
  --data-pack ../public-packs/duo-data/1.0.6-public.2 `
  --rules-text-pack ../public-packs/duo-rules-text/1.0.6 `
  --art-pack ../public-packs/duo-art/1.0.0-public.1 `
  --corpus-dir ../local-corpus `
  --output-dir ../packassets-preview `
  --pin-out ../pack-pin.proposed.json
```

Each input can be an installed pack directory or an existing USTAR `.tar.gz`
archive with `<id>/<version>/pack.json` and its payloads. Existing archives must
contain only regular files and directories; links, PAX/GNU extensions, duplicate
paths and traversal paths refuse. Directories produce deterministic USTAR/gzip
archives: sorted paths, fixed modes, zero timestamps and numeric ownership,
without owner names or local paths. Original payload and manifest bytes stay
unchanged. A data version must end in `-public.<number>`; this label does not
replace the scan.

The output directory must be new or empty. The proposed pin must be a new file.
The tool refuses existing outputs, linked paths, overlapping input/output paths,
and protected live/operator input locations. Keep the prepared files outside the
repository. It does not find saves, select installed packs or modify inputs.

Add `--save-copy ../scrubbed-copy.json` only for an already scrubbed disposable
JSON copy. The tool scans it and emits `scrubbed-save.json` as a separate release
asset. CI's pack pin contains only the three pack archives; the fetcher treats
every listed asset as a tar archive. Never commit a real save or its derivatives.

## Scan and verification

Before writing outputs or invoking GitHub, the tool scans every supplied file
through `scripts/secret-scan/scan.mjs`, including unlisted files, archive members,
headers, and outer archive transport bytes. Gzip payloads are scanned in both
transport and expanded form. It uses bounded scan windows with overlap and
preserves UTF-8 characters across reads. Binary inspection uses the scanner's
printable-run policy; it is not image recognition or a proof of anonymization.

`--corpus-dir` takes precedence over `SECRET_SCAN_CORPUS`, then the scanner's
default `.local/export-gate` is tried. An explicitly selected or present corpus
that cannot be loaded refuses. When none exists, the tool reports pattern-only
coverage. Use the local corpus for a publication review. A finding blocks all
outputs and commands. Reports contain category counts and input-file ordinals,
with matched values and source paths withheld. Overlapping windows can count
the same finding more than once. No scan bypass option is provided.

`scripts/secret-scan/pack-reviewed.json` contains reviewed false positives for
exact pack-relative paths, categories and complete payload SHA-256 receipts.
The publisher applies a review only after hashing the entire payload. Changed
bytes lose the review, even when the filename and JSON field stay the same.
Private-fingerprint collision reviews also require the exact SHA-256 of the
reviewed local `corpus.json`; changing the corpus requires another review.
Optional JSON pointers document the reviewed fields. Gzip transport and expanded
JSON have separate receipts. Filename, archive-header, outer archive transport,
tag and optional-save findings remain blocking. Accepted review counts are
reported separately from blocking findings. These reviews do not change the
repository scanner's hosts, patterns, placeholders or line exceptions.

The pack-only `scripts/secret-scan/pack-patterns.mjs` check also rejects home
folder paths in provenance, including generic account names, encoded forms and
file URIs. These findings block independently of every exact review above.
Generic examples allowed in repository documentation are not allowed in packs.

After a clean scan, every manifest receipt must match its file's SHA-256 and
size; extra and missing files refuse. Data and rules text must have the same
rule contract hash. The tool rechecks input bytes while preparing assets, so a
changed source refuses. Limits are 512 MiB per expanded file, 1 GiB per input
archive, 50,000 members and 16 MiB per pack manifest or optional save copy.

## Pin format and commands

The proposed pin matches `.github/packs/fetch-packs.mjs`:

```json
{
  "schema": "rs3-ci-pack-pin-v1",
  "tag": "packs-public-2026-10-21",
  "selection": {
    "data": { "id": "duo-data", "version": "1.0.6-public.2", "sha256": "<manifest sha256>" },
    "rulesText": { "id": "duo-rules-text", "version": "1.0.6", "sha256": "<manifest sha256>" },
    "art": { "id": "duo-art", "version": "1.0.0-public.1", "sha256": "<manifest sha256>" }
  },
  "assets": [
    { "name": "duo-data-1.0.6-public.2.tar.gz", "sha256": "<archive sha256>", "bytes": 123 }
  ]
}
```

The actual `assets` array has all three archives. Asset hashes cover exact gzip
bytes; selection hashes cover exact `pack.json` bytes. CI verifies archive size
and hash, extracts into a common tree, then writes `selection.json` as
`{ "schemaVersion": 1, ...pin.selection }`. CI also verifies manifest and payload
receipts before placing files. Existing checkout files take precedence.

A successful dry run prints the tag, each asset's name, size, SHA-256 and exact
`gh release create` / `gh release upload` commands. Run those commands from the
prepared asset directory after approval. Creation uses `--verify-tag`: the tag
must already exist on GitHub. For an existing release, skip creation. Upload has
no `--clobber`, so existing asset names refuse. Release notes refer to the
repository's Wiki attribution and third-party notices.

`--apply` exists but refuses unless `RS3_PUBLISH_APPROVED` equals the tag exactly.
It still scans and verifies inputs first. Approval is needed for the push/tag,
release/upload and adopting the proposed pin. This job never runs `--apply`.
No workflow changes or new secrets are needed.

Focused verification:

```powershell
node --test --test-timeout=120000 tests/pack-publish.test.mjs tests/ci-pack-fetch.test.mjs
```

Create a separate public data pack before publishing:

```powershell
node scripts/packs/scrub-public-pack.mjs `
  --input C:/pack-work/private/duo-data/1.0.6 `
  --output C:/pack-work/public/duo-data/1.0.6-public.2 `
  --rules-text-pack C:/pack-work/public/duo-rules-text/1.0.6 `
  --version 1.0.6-public.2 --report C:/pack-work/scrub-report.json
```

All paths are explicit; the script never finds a save or installed private pack.
It verifies source receipts and rejects unlisted files, links, protected input
locations, existing outputs and input/output overlap. It processes files
sequentially and preserves unchanged payload bytes. It removes the account-name
defaults at `/values/app~1core~1game-progress.mjs#defaultRuneScapeNames` in both
the authored legacy values file and `indexes/values.json`. An empty binding is
already supported by the starter dataset. It replaces complete JSON string
values containing home paths with `redacted-local-source`, including gzip JSON.
Home paths in object keys refuse instead of silently changing schema keys.
Exact nested SHA-256 references and paired byte counts are repaired until
stable; ambiguous or cyclic transitions refuse. This includes geometry input
hashes and the geometry bundle's own manifest receipt. Gameplay names, IDs,
geometry and encoded masks retain their meaning. It recalculates file receipts
and the dataset digest while preserving the rules contract. The legacy distribution
marker remains `private-local`, which the current runtime requires.

The report records file names and replacement counts, never old account names
or IDs. This bounded scrub policy does not certify arbitrary private content;
the publisher's corpus and pattern gate must still pass. Never edit an existing
pack in place or commit pack payloads, a corpus, or a save derivative.

Art metadata needs the same provenance scrub, using a separate output version:

```powershell
node scripts/packs/scrub-public-pack.mjs --kind art `
  --input C:/pack-work/private/duo-art/1.0.0 `
  --output C:/pack-work/public/duo-art/1.0.0-public.1 `
  --version 1.0.0-public.1 --report C:/pack-work/art-scrub-report.json
```

To verify a local cleaned data/rules pair with the current picker, set
`RS3_PUBLIC_SCRUB_PACKS_DIR`, `RS3_PUBLIC_SCRUB_DATA_VERSION` and
`RS3_PUBLIC_SCRUB_RULES_VERSION`, then run:

```powershell
node --max-old-space-size=768 --test --test-concurrency=1 --test-timeout=120000 tests/pack-public-scrub.test.mjs
```

Clear inherited `RS3_*` settings before supplying these three test settings.
Add `RS3_PUBLIC_SCRUB_ART_VERSION` to validate all art JSON metadata and image
samples from every component, and
`RS3_PUBLIC_SCRUB_SOURCE_DIR` to compare the data source's geometry masks.
The conditional test verifies all runtime pack receipts, generated/authored
equality, rules contract and dataset digest, then loads the picker's inputs and
geometry without a fallback. It checks nested geometry receipts too.
Without these settings it skips only the actual-pack check; synthetic safety
and policy tests still run. No server or gameplay storage is opened.
