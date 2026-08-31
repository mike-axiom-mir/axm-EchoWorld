# EchoWorld v0.01 Claim Boundary

## Observed in this lane

The current lane demonstrates a small deterministic persistent-cell harness with:

- stable cell identity and canonical revision state;
- bounded CANONICAL and OBSERVED memory with separate provenance;
- deterministic specialist proposal matching, stale rejection, and conflict preservation;
- bounded deterministic handoff propagation and scheduling;
- persistent deferred delivery for simulated busy cells;
- copy-on-write working-memory compaction;
- a persisted compaction journal containing complete before/after images and hashes;
- deterministic compaction IDs and generations;
- automatic reload recovery from interruption after prepare, working swap, compressed swap, or commit-receipt write;
- exactly one final commit receipt for each recovered compaction;
- idempotent recovery after a compaction has been repaired;
- deterministic rollback to the complete before-image when the after-image is corrupt;
- explicit `REPAIR` lock when the before-image is corrupt and cannot be trusted;
- provenance-aware compaction that does not merge CANONICAL and OBSERVED records;
- snapshot-shape validation and non-canonical state backfill;
- canonical hash equality with memory disabled versus enabled, including scheduler-enabled replay.

GitHub Actions executed 49 tests on Node.js v22.23.2: 49 passed and 0 failed.

The nine new compaction checks cover normal commit, four injected interruption points, idempotency, corrupt-after rollback, corrupt-before repair lock, and provenance separation.

## Interpretation

The results support the separation between canonical physical truth and experiential/advisory/perception/scheduling/memory-maintenance layers for this prototype.

They show that a persisted intermediate compaction state can be recognized and deterministically completed after reload without losing or duplicating tested memory records.

They also show that EchoWorld can distinguish between a corrupt proposed after-image, which can safely roll back to a valid before-image, and a corrupt before-image, where the system lacks a trustworthy source and must stop in `REPAIR`.

This is stronger than the previous unjournaled two-array mutation. It is not equivalent to crash-atomic durable storage.

## Compaction proof boundary

The tested interruption points are deliberate in-process fault injections:

- `AFTER_PREPARE`
- `AFTER_WORKING_SWAP`
- `AFTER_COMPRESSED_SWAP`
- `AFTER_COMMIT_RECEIPT`

The world is then serialized and reloaded. The proof therefore covers recovery from intermediate states that were successfully captured in a JSON snapshot.

It does not yet cover:

- process termination while the snapshot file itself is being written;
- partial filesystem writes;
- fsync or storage-controller durability;
- corruption of both before and after journal images;
- reconstruction from an external lineage archive;
- transactions spanning memory, active queue, and deferred mailbox together.

## Deferred-delivery boundary

Deferred TTL remains a deterministic scheduler-drain epoch, not a real-time deadline. Deferred arrivals remain unaccepted and create no perception or memory until release. Mailbox overflow and terminal policy failures are explicit but not yet losslessly archived.

## Benchmark boundary

The existing v0.02 benchmark compares envelope-only scheduling, recipient lifecycle with memory disabled, and recipient lifecycle with memory enabled on one local environment.

No compaction interruption/recovery benchmark has been added. The current compaction evidence is correctness evidence, not a performance claim.

## Next proof work

- crash-atomic snapshot writing with temporary file, integrity envelope, atomic replacement, and recovery selection;
- a transaction boundary spanning queue, mailbox, and pending compaction state;
- explicit repair tooling for corrupt-before journals using trusted lineage where available;
- cross-revision policy for paused/deferred work;
- fairness and ownership rules across unrelated schedulers targeting one cell;
- longer mixed-event/property tests;
- larger sleeping-world activation, mailbox, memory, journal, and storage measurements;
- physical/domain propagation rules such as attenuation and material response;
- external lineage for queue or mailbox overflow where lossless continuation is required.

## Not proven

Do not claim that EchoWorld:

- provides crash-atomic or power-loss-safe durable storage;
- can automatically repair a journal whose source before-image is corrupt;
- is cheaper than conventional engines;
- scales to massive persistent worlds;
- provides production multiplayer determinism;
- models realistic sound or fire propagation;
- handles genuine simultaneous cell execution;
- guarantees scheduler fairness;
- creates compelling emergent stories;
- safely resolves every conflicting physical proposal;
- contains independent parallel workers;
- contains AI;
- makes AI safe by itself.

Specialists remain proposal-only. Perception, compaction, repair state, and deferred delivery remain non-canonical. AI is not integrated in v0.01.
