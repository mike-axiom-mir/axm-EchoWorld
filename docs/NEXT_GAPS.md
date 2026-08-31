# Next Gaps

The next implementation work should strengthen deterministic proof rather than add product layers.

Completed in lane 01:

- duplicate, cycle, hop-limit, future-revision, and repeated-arrival handoff guards;
- deterministic queued scheduling and explicit processing/queue budgets;
- persisted scheduler pause/resume;
- SOUND recipient wake/specialist/perception/memory/relay/sleep lifecycle;
- CANONICAL versus OBSERVED memory provenance;
- direct and scheduler-batch canonical hash witnesses;
- bounded persistent busy-cell deferred delivery;
- deterministic logical-epoch TTL, retry, deduplication, and exact-once release;
- explicit mailbox overflow, expiry, retry-exhaustion, and release-blocked receipts;
- persisted mailbox pause/resume;
- copy-on-write working-memory compaction;
- persisted before/after compaction journal with hashes;
- deterministic recovery from four interruption points;
- corrupt-after rollback without invented memory;
- corrupt-before fail-closed `REPAIR` state;
- idempotent recovery and one final commit receipt;
- provenance-preserving compaction summaries;
- 49-test GitHub Actions checkpoint;
- local three-mode scheduler/lifecycle metrics.

Priority order now:

1. crash-atomic snapshot persistence using integrity envelopes, temporary files, atomic replacement, and deterministic recovery selection;
2. unify queue, deferred mailbox, and compaction journal into an explicit persisted transaction/checkpoint boundary;
3. trusted-lineage repair tool for corrupt-before compaction journals;
4. explicit cross-revision policy for paused and deferred jobs;
5. deterministic fairness/ownership rules across unrelated schedulers targeting one cell;
6. longer mixed-event/property tests;
7. larger sleeping-world activation, mailbox, compaction-journal, and storage measurements;
8. material-aware attenuation and domain propagation rules;
9. lossless external overflow/lineage strategy for active queue or mailbox capacity failure;
10. genuine concurrent execution experiments after the deterministic single-thread proof remains stable.

Keep all work for this chat on `chatgpt/echoworld-lane-01`.

No AI belongs in v0.01.
