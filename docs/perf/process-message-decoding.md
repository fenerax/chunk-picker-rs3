# Avoid copying received message graphs again

Advanced process IPC already deserializes a private graph for each received
message. The old shared-buffer decoder cloned that graph again while looking
for placeholders. The CPU profile attributed about 2.7 seconds of main-process
self time across the measured scenario to that decoding walk.

`decodeReceivedProcessMessage` consumes only fresh IPC envelopes at the three
receive sites. Messages without shared placeholders return their existing
deserialized data. Other messages restore placeholders in place, preserving
cycles, aliases, Map/Set insertion order and container identities. Shared-buffer
allocation and view reconstruction use the original code. Outgoing encoding
and the general-purpose cloning decoder retain their existing contracts.

The same profile attributed about one second per cold host to outgoing encoding.
Native Worker message events also deliver an owned cloned graph. Their host now
uses `encodeReceivedWorkerMessage` to replace shared buffers in that graph,
avoiding another allocation for every ordinary container. Caller-owned request
and worker-initialization data still use the unchanged cloning encoder. Shared
bytes are copied into the envelope as before; source data in the worker isolate
is untouched. Unchanged properties and Map/Set entries need no write.

The synthetic transport test compares received envelopes produced by V8
serialization against the unchanged cold decoder. It covers ordinary and shared
graphs, root buffers and all supported views, offsets and backing aliases,
cyclic Map/Set keys and values, sparse arrays, atomic values and safe data
properties including `__proto__`. Native structured-clone fixtures additionally
compare owned encoding with the original encoder across the same graph shapes.
Worker and complete-calculation checks also
exercise the production receive path.

See [scenario methodology](picker-scenarios.md) for timing and memory details.

Three alternating trials reduced median startup from 22.76 to 21.00 seconds,
both Group lists from launch from 41.27 to 37.41 seconds, and Area check from
16.27 to 14.22 seconds. In the later CPU profile, the main receive transformation
took about 1.5 milliseconds across the scenario and each cold host's outgoing
transformation took about 0.3 seconds. These component samples are separate from
the unprofiled wall-time medians. Overall worker RSS did not improve; see the
retention measurements before treating fewer message copies as an RSS guarantee.
