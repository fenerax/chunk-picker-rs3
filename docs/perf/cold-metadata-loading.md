# Cold metadata loading

## Copy each corrected category once

`applyMetadataCorrections` previously spread an entire category dictionary after
every changed record. On large categories, hundreds of corrections repeatedly
copied the same thousands of unchanged entries. CPU profiles identified that
copying in both startup and cold Group-worker compilation.

The function now detaches a category dictionary on its first successful change
and writes subsequent corrected records into that private dictionary. Record
and nested-map copying, sequential precondition validation and strict failures
keep their existing behavior. Inputs and untouched records remain shared exactly
as before. Aliased categories detach independently. A data-property definition
preserves spread semantics, including key order and a label named `__proto__`.

The synthetic frozen-input test compares a batch with a sequence of independent
one-correction calls, reproducing the previous category-copy behavior. It covers
repeated labels, aliased categories, nested numeric maps, field deletion,
missing/drifted no-ops, strict failure and unusual property names. Complete JSON
bytes and input identities are checked.

Measurement uses the same pinned source/input selection and interleaved fresh
servers described in [scenario methodology](picker-scenarios.md).
After the transport change, three-trial median startup fell from 21.00 to 18.75
seconds and both Group lists from launch fell from 37.41 to 33.90 seconds. The
metadata-stage startup range was 18.73–24.13 seconds; the slow trial passed the
pre/post quiet checks and remains included. Its extra time preceded the named
server-startup stages.
