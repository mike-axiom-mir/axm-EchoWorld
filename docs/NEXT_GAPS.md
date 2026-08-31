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
- local three-mode scheduler/lifecycle metrics.

Priority order now:

1. bounded retry or deferred delivery when a recipient cell is already active;
2. interruption-safe memory compaction;
3. crash-safe atomic persistence and scheduler recovery;
4. explicit cross-revision policy for paused jobs;
5. longer mixed-event/property tests;
6. larger sleeping-world activation and storage measurements;
7. material-aware attenuation and domain propagation rules;
8. lossless external overflow/lineage strategy where required.

Keep all work for this chat on `chatgpt/echoworld-lane-01`.

No AI belongs in v0.01.
