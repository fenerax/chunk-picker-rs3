# Dataset load memory

Every process that imports `app/dataset-runtime.mjs` resolves and verifies the
selected dataset before any gameplay module runs. With a pack-installed
dataset of about 130 MB of JSON, that verification alone used most of a test
process's memory.

## Method

`scripts/perf/scale-dataset.mjs` writes a deterministic synthetic companion:
a `duo-data` pack, a `duo-rules-text` pack and an installed profile, all
hash-pinned through the same seams a private dataset uses. It scales
open-f2p's shape (definitions, task map, catalogue rows, values and rule text)
and replaces every name and number with a synthetic token of the same shape.
Scale 119 gives 132.7 MiB of inputs in 68 files: four catalogues of about
25 MiB each, 25 MiB of definitions, a 3 MiB task map and 4 MiB of values. The
companion includes reviewed-correction and overlay files that touch a
proportional number of records, about 5,000 at that scale.

`scripts/perf/dataset-load.mjs` profiles one fresh process per run. Stage marks
come from `traceDatasetLoad` inside `resolveDataset`, and then from the same
calls the server makes: the pipeline imports, `loadDatasetInputs`, the
definitions parse, `prepareServerDefinitions`, then values materialization and
freezing. Heap peaks come from V8's GC trace, resident peaks from the kernel's
high-water mark, and work kinds from a CPU profile. Medians of 5 runs, Node
24.22, Linux, 4 vCPU. The base is the previous `main` with only the trace marks
added.

## Results

132.7 MiB synthetic companion (scale 119):

| Stage | Time before | Time after | Heap peak before | Heap peak after | RSS high-water before | RSS high-water after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Profile and selection | 32 ms | 25 ms | 6.7 MiB | 6.6 MiB | 54 MiB | 54 MiB |
| Data pack: read, hash, validate | 1,499 ms | 701 ms | 91.2 MiB | 13.5 MiB | 400 MiB | 84 MiB |
| Rules-text pack | 12 ms | 14 ms | 82.2 MiB | 13.5 MiB | 400 MiB | 84 MiB |
| Values and authored transcriptions | 39 ms | 51 ms | 94.4 MiB | 21.1 MiB | 400 MiB | 106 MiB |
| Rule contract and dataset digests | 11 ms | 11 ms | 95.0 MiB | 20.1 MiB | 400 MiB | 108 MiB |
| Pipeline module data (corrections JSON) | 1,764 ms | 27 ms | 102.7 MiB | 27.5 MiB | 400 MiB | 110 MiB |
| Definition inputs: bytes and pins | 75 ms | 53 ms | 55.6 MiB | 27.7 MiB | 400 MiB | 134 MiB |
| Definitions parse | 134 ms | 184 ms | 86.4 MiB | 63.8 MiB | 400 MiB | 217 MiB |
| Corrections and overlays | 9,646 ms | 101 ms | 154.9 MiB | 80.5 MiB | 475 MiB | 256 MiB |
| Values materialize and freeze | 14 ms | 15 ms | 150.6 MiB | 81.6 MiB | 475 MiB | 256 MiB |
| **Whole load** | **13,338 ms** | **1,208 ms** | **154.9 MiB** | **81.6 MiB** | **475 MiB** | **256 MiB** |

Resolving the dataset alone, which every test process pays, fell from 400 to
108 MiB RSS and from 1,593 to 802 ms. The digest is identical before and after.
CPU work kinds for the whole load, from one profiled run: hashing 195 → 165 ms, UTF-8 decoding
180 → 35 ms, buffer copies 95 → 1 ms, garbage collection 541 → 135 ms, and the
new streaming syntax check 420 ms in place of the discarded parses.

The two stages that build large parse trees (the authored transcriptions and
the definitions) are 10–50 ms slower. The heap now starts small, so V8
collects more often while it grows; they parse the same bytes as before.

open-f2p scale (synthetic scale 1, 1.3 MiB of inputs): whole load 256 → 243 ms,
RSS high-water 75.4 → 72.5 MiB, heap peak 12.1 → 9.1 MiB. The bundled open-f2p
provider is unchanged: 52 → 60 ms (noise), 71.9 MiB RSS both.

## What changed

- `inspectFile` reads each file once. Every byte is hashed as it arrives while
  the next chunk is already being read. Collected files go straight into one
  exact-size buffer; others reuse two 1 MiB chunks. Earlier code pushed stream
  pieces, concatenated them, decoded a string and parsed a tree that was then
  discarded.
- Pack inputs are validated eagerly by `app/dataset-json-check.mjs`, a
  streaming syntax check that accepts exactly what
  `JSON.parse(bytes.toString('utf8'))` accepts, without building anything.
  Its tests compare it with `JSON.parse` on edge cases and on mutated documents
  split at random chunk boundaries. Gzip inputs still use `gunzipSync` with the
  same output limit.
- The values snapshot is parsed from the same verified read rather than read
  and hashed a second time. It is decoded in place, since the loader owns the
  freshly parsed tree.
- `loadDatasetInputs` reuses the provider's verified digest of the exact bytes
  it returns, so definitions are not hashed twice. CRLF text still takes the
  repository-text hash.
- Definition overlays copy each record on a patched path once per application,
  not once per patch. With thousands of patches in a large category, the old
  per-patch spread of the whole category was quadratic.
- Overlay-selected retained corrections are deduplicated against the reviewed
  list with a set of their JSON text, not by a nested comparison.

Pack digests, profile and selection pins, file fingerprints, size limits,
read-time re-hashing in `bytes()` and every refusal are unchanged.
`tests/dataset-packs.test.mjs` builds synthetic packs and checks acceptance,
invalid JSON with matching hashes, changed or grown files, profile, selection
and digest pins, use-time changes, and the full correction pipeline. Its
refusal and pipeline cases pass unchanged against the previous loader.

Not done: there is no full-dataset `structuredClone` on the public packed load
path, so nothing was removed there. A cached pre-validated snapshot was not
added. Every file must still be read and hashed to match its pin, and that
costs about as much as the streaming check that a snapshot could skip.
