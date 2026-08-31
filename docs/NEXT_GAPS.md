# Next Gaps

The next implementation work should strengthen deterministic proof rather than add product layers.

Completed in lane 01:

- duplicate handoff suppression;
- cycle-safe bounded multi-hop envelopes;
- future-revision guard;
- stale proposal rejection;
- deterministic conflict preservation;
- queued deterministic scheduling;
- processing and queue-capacity budgets;
- persisted scheduler pause/resume;
- recipient-cell wake/specialist/perception/memory/relay/sleep lifecycle for SOUND;
- CANONICAL versus OBSERVED memory provenance;
- direct and scheduler-batch canonical hash witnesses;
- bounded persistent busy-cell deferred delivery;
- deterministic logical-epoch TTL and retry policy;
- deferred-event and deferred-causal-arrival deduplication;
- exact-once release after a recipient becomes DORMANT;
- explicit mailbox overflow, expiry, retry-exhaustion, and release-blocked receipts;
- persisted mailbox pause/resume;
- local three-mode scheduler/lifecycle metrics.

Priority order now:

1. interruption-safe memory compaction;
2. crash-safe atomic persistence for queue/mailbox transitions and scheduler recovery;
3. explicit cross-revision policy for paused and deferred jobs;
4. deterministic fairness/ownership rules across unrelated schedulers targeting one cell;
5. longer mixed-event/property tests;
6. larger sleeping-world activation, mailbox, and storage measurements;
7. material-aware attenuation and domain propagation rules;
8. lossless external overflow/lineage strategy for active queue or mailbox capacity failure;
9. genuine concurrent execution experiments after the deterministic single-thread proof remains stable.

Keep all work for this chat on `chatgpt/echoworld-lane-01`.

No AI belongs in v0.01.
