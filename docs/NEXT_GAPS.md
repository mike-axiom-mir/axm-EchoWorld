# Next Gaps

The next implementation work should strengthen deterministic proof rather than add product layers.

Completed in lane 01:

- duplicate handoff suppression;
- cycle-safe bounded multi-hop envelopes;
- stale proposal rejection;
- deterministic conflict preservation;
- queued deterministic scheduling;
- processing and queue-capacity budgets;
- persisted scheduler pause/resume;
- local scheduler metrics.

Priority order now:

1. recipient-cell wake/sleep processing for accepted handoffs;
2. bounded perception/memory update from accepted non-canonical signals;
3. interruption-safe memory compaction;
4. crash-safe atomic persistence and scheduler recovery;
5. longer mixed-event/property tests;
6. larger sleeping-world activation and storage measurements;
7. lossless external overflow/lineage strategy where required.

Keep all work for this chat on `chatgpt/echoworld-lane-01`.
