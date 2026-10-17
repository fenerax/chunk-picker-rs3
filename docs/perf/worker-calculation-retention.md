# Worker calculation retention

Each worker now retains two complete member/revision calculation results rather
than four. It releases the oldest retained graph before allocating a replacement.
Current-result reuse and advisory upgrade behavior are unchanged. An in-flight
request retains its own snapshot reference, so eviction cannot invalidate work
already using that result. Older requests rebuild through ordinary evaluation.

The separate four-entry state-transfer cache is unchanged. Its capacity is part
of the scheduler's protocol and cannot be reduced independently. Eligibility
proofs, sandbox results and prediction limits also retain their existing bounds.

The worker regression crosses four revisions, checks that the latest two
results are reused and that older calculations rebuild, then compares the oldest
rebuilt complete play bytes with both the original response and a fresh worker.
Requests omit state bytes on the retained and evicted paths, proving that all
four transferred states remain available despite calculation eviction.

Measurement uses the same pinned source/input selection and interleaved fresh
servers described in [scenario methodology](picker-scenarios.md). The memory phase changes challenge
checks across six further revisions so historical calculation retention is
actually exercised. RSS is a sampled process measurement, not a heap-size or
object-count guarantee.

Three alternating corrected-sampler trials reduced median combined-worker peak
from 2787.8 to 2730.5 MiB compared with the other fixes alone. Every paired sample
was lower, but the ranges overlap: 2732.9–2863.6 versus 2725.6–2743.2 MiB. Main
RSS was essentially unchanged, 1634 versus 1633 MiB. This is a small reduction,
not a general memory win: the final worker peak remains above the freshly matched
rel3b median of 2568.7 MiB. The largest sampled worker peak occurs during Area
check with the third calculator resident. Main and worker maxima are separate.
