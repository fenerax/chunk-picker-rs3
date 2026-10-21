# Local art packs

This is the first, art-only packaging seam. It changes picture providers and
preserves existing data, task identities, rules, saves and invite permissions.
Packaging does not establish permission to acquire, host or redistribute artwork.

Install a pack in an operator-owned folder outside the checkout, or ignored
`.local/packs` for disposable work. The builder reads explicit local sources,
copies bytes without text or image normalization, writes `pack.json` last, then
atomically selects the hash-pinned manifest. An existing version directory is
never overwritten, including an interrupted installation.

```powershell
node scripts/build-art-pack.mjs --source-root C:/path/to/private-checkout --packs-dir C:/path/to/picker-packs --version 1.0.0
$env:RS3_PACKS_DIR = 'C:/path/to/picker-packs'
node app/server.mjs
```

Restart the server and reload open pages after selecting a new version. There is no folder watcher,
automatic upgrade, network download or browser installer. `--no-select` constructs
and validates an installation without changing the operator's selection. Use
`--selection` to choose a receipt outside the pack directory. A failed build
leaves any prior selection intact; its incomplete new version folder can be
inspected before choosing another version.

Optional `--map-assets`, `--terrain-assets`, and `--icon-assets` take existing
local asset roots. Their corresponding `RS3_*_ASSETS_DIR` environment variables
are also supported. Map assets default to the source checkout's
`.local/map-assets`; terrain and icons inherit that root. Absent optional roots
are omitted. Shared source directories are copied once and share a declared
pack root. The builder copies current nested manifests, their declared picture
records and reachable pin metadata; it omits raw captures and unrelated files.
It reuses existing tile/icon byte counts and SHA-256 receipts instead of hashing
the entire tree repeatedly. These payload hashes are checked on first use.
Small JSON manifests are checked before activation. The existing large interior
diagnostic manifest is copied and stream-hashed as `role: "opaque-manifest"`;
its tile receipts come from the current committed interior descriptor. The
loader verifies those diagnostic bytes lazily without parsing them. It preserves
the original nested JSON bytes and existing application descriptor contracts.

`app/art-bindings.mjs` explicitly lists the current legacy top-level resource
pictures, RS3 SVGs, two task PNGs, world/background and font routes. Missing
individual source pictures are omitted, so a partial installation can fall back
per file. No unlisted source folder becomes a serving root. The builder also
accepts injected source roots/bindings and nested manifest paths for synthetic
fixtures; the CLI uses the explicit production binding table.

## Manifest and selection

Folder layout is `duo-art/<semantic-version>/pack.json`. Schema 1 has kind `art`,
ID `duo-art`, `distribution: "private-local"`, and these compatibility requirements:

```json
{
  "corePackApi": 1,
  "datasetId": "duo-legacy",
  "datasetContractVersion": 1,
  "coordinateSystem": "surface-grid-v1"
}
```

The manifest declares component `roots`, `catalogues.artBindings`, provenance,
and a unique flattened `files` list with `path`, byte count and SHA-256 for each
payload, including every nested manifest. It excludes its own bytes. Only
declared files can be returned by the loader. Art bindings declare an existing
same-origin route, component and relative file; duplicate routes are invalid.

```json
{
  "schemaVersion": 1,
  "art": {
    "id": "duo-art",
    "version": "1.0.0",
    "sha256": "<64 lowercase hexadecimal characters>"
  }
}
```

`RS3_PACK_SELECTION` can override the selection-file path. With no configuration,
the loader uses checkout-local `.local/packs/selection.json`. It reads only this
selection, and never chooses a newer or differently named pack by enumeration.
Every changed payload requires a new immutable version and manifest digest.
The builder preserves exact prior receipt bytes as `selection.json.previous`
(or `<custom-selection>.previous`). Restore that receipt deliberately and restart
to roll back. Keep the prior pack directory too. Hashes provide integrity against
the receipt, not authorship or protection when both files are replaced.

## Validation and failure behaviour

`loadArtPack({ packsDir, selectionPath })` returns a provider with `status()`,
`root(component)`, `files(component)`, route `bindings`, and asynchronous
`file(component, relative)`. `file` returns a validated filename or `null`.
`expected(filename)` supplies the pinned byte count/digest for the HTTP serving
layer to verify the bytes it opens after path validation.
`status` reports kind, ID/version/digest, component names and health without
absolute paths. A missing receipt is `absent`; a corrupt manifest or incompatible
selection is `invalid`; a missing/corrupt individual picture or optional nested
JSON is `partial`. Bindings and provenance are critical activation inputs.
Other good pictures remain available. The server's authenticated routes and
authored placeholders handle unavailable pictures without changing gameplay.

The loader rejects traversal, absolute/drive/UNC paths, alternate streams,
encoded paths, reserved Windows names, symlinks, junctions and paths whose
canonical target differs. It validates root/JSON containment at activation and
each image's containment when first accessed and again after hashing. The loader
checks each payload hash at most once per process; subsequent opens check metadata and containment, and
refuse replaced or edited files. Selected roots never grant directory listing
or unrestricted download access.

Limits are 100,000 declared files, 128 MiB per payload, 32 MiB per parsed JSON, 8 GiB
total declared bytes, dimensions up to 32,768 and 150 million pixels. Images must
have a matching PNG/WebP format and bounded dimensions; PNGs need their complete
IEND footer. Fonts must have WOFF2 headers. Exact legacy SVG bytes are admitted by
an explicit reviewed digest table. New SVGs accept only inert drawing primitives
with bounded dimensions and a small attribute set; scripts, style/CSS, external
references, HTML, entities, event handlers and active media are rejected.

These checks address ordinary corruption and path redirection. Immutable packs
are operator-owned local inputs; changing them while the server is running is
unsupported. Stop the server before replacing a selection or removing old packs.

## Resolver and public fallbacks

For each component, the server resolves an explicit injected/legacy environment
root first, then a selected pack root, then the existing tracked/local default
for this milestone, then the authored public fallback. Terrain and icon roots
inherit the map root when separate roots are absent. Test roots can point to
small synthetic fixtures without using the real private artwork. Settings → Advanced
shows selected kind, version and health without exposing filesystem paths.
After building from existing asset-root environment variables, clear those
overrides in the server process to use the selected pack for optional artwork.
Retaining an override deliberately gives that provider priority. The authenticated
`/api/art-status` receipt reports symbolic component providers without paths.

The private checkout still keeps its tracked and local defaults when no pack is
selected. This milestone alone does not produce an independent public tree.
Later milestones separate the data/identity/rules providers and remove those
private defaults from the public installation. A partial or invalid selected
component continues through the explicit tracked/local default before its
authored public fallback, following the same resolution order.

Fallback pictures retain exact item and slot names. Generic item/category
symbols do not invent an item identity. Missing terrain and world art use the
same coordinate grid, selections and ownership outlines; unavailable interiors
keep their unavailable state. Clue highlights and coordinates keep their data
inputs. Pack selection changes no access calculation, task identity, rules,
save revision, invitation, viewer capability or overlay authorization.

After stopping the server, a deliberate receipt rollback can use:

```powershell
Copy-Item -LiteralPath 'C:/path/to/picker-packs/selection.json.previous' -Destination 'C:/path/to/picker-packs/selection.json'
node app/server.mjs
```

Retain the referenced immutable version folder and use the matching core code
when rolling back. Keep saves and access credentials in their existing storage
directory, separately from packs.
