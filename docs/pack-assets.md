# Pack release assets

`scripts/packs/publish-assets.mjs` prepares release assets and a proposed CI pin.
Dry run is the default. It runs no GitHub command and never updates the checked-in
`.github/packs/pack-pin.json`.

Use Node 24 with no installed dependencies. Supply all three packs explicitly:

```powershell
node scripts/packs/publish-assets.mjs --tag packs-public-2026-10-21 `
  --data-pack ../public-packs/duo-data/1.0.6-public.1 `
  --rules-text-pack ../public-packs/duo-rules-text/1.0.6 `
  --art-pack ../public-packs/duo-art/1.0.0 `
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
the same finding more than once. No exception or scan bypass option is provided.

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
    "data": { "id": "duo-data", "version": "1.0.6-public.1", "sha256": "<manifest sha256>" },
    "rulesText": { "id": "duo-rules-text", "version": "1.0.6", "sha256": "<manifest sha256>" },
    "art": { "id": "duo-art", "version": "1.0.0", "sha256": "<manifest sha256>" }
  },
  "assets": [
    { "name": "duo-data-1.0.6-public.1.tar.gz", "sha256": "<archive sha256>", "bytes": 123 }
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
