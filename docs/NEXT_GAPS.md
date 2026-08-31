# Next Gaps

The next implementation work should strengthen deterministic proof rather than add product layers.

Completed in lane 01:

- deterministic canonical world rules and canonical hashing;
- bounded CANONICAL and OBSERVED memory;
- temporary specialist proposal receipts and deterministic merge;
- bounded handoff guards and queued scheduling;
- recipient SOUND lifecycle;
- persistent deferred delivery for busy cells;
- copy-on-write memory compaction and interruption recovery;
- integrity-wrapped atomic snapshot envelopes;
- deterministic snapshot generations and immediate parent IDs;
- primary, backup, temp, and recovery-temp candidate validation;
- highest-valid-generation recovery;
- fail-closed same-generation conflict detection;
- temp-file fsync, backup preservation, atomic primary rename, and directory fsync;
- restartable recovery promotion;
- nine abrupt child-process exit recovery checks;
- composition of atomic snapshot loading with pending compaction recovery;
- 67-test GitHub Actions checkpoint;
- source-honest evidence and claim boundaries.

Priority order now:

1. deterministic single-writer lease with stale-owner recovery;
2. fencing token or compare-and-swap generation admission to prevent stale writers;
3. checkpoint barrier spanning canonical mutation, active queue, deferred mailbox, and compaction journal;
4. process-exit tests during lock acquisition, ownership transfer, checkpoint admission, and lock release;
5. complete bounded parent-chain verification and snapshot lineage retention;
6. trusted external recovery when every local snapshot candidate is invalid;
7. explicit cross-revision policy for paused scheduler and deferred mailbox work;
8. fairness and ownership rules across unrelated schedulers targeting one cell;
9. longer mixed-event/property tests;
10. platform matrix for Linux filesystems, Windows, macOS, and controlled network-filesystem experiments;
11. dedicated atomic persistence, fsync, recovery, mailbox, and compaction benchmarks;
12. larger sleeping-world activation, journal, and storage measurements;
13. material-aware attenuation and domain propagation rules;
14. lossless external overflow lineage for active queue or mailbox capacity failure;
15. genuine concurrent execution experiments after single-writer and checkpoint boundaries are proven.

Keep all work for this chat on `chatgpt/echoworld-lane-01`.

No AI belongs in v0.01.
