# EchoWorld v0.01 Claim Boundary

## Observed in this lane

The current lane demonstrates a small deterministic persistent-cell harness with:

- stable cell identity and canonical revision state;
- bounded CANONICAL and OBSERVED memory with separate provenance;
- deterministic specialist matching, stale rejection, and conflict preservation;
- bounded deterministic handoff propagation and scheduling;
- persistent deferred delivery for simulated busy cells;
- copy-on-write working-memory compaction and deterministic reload recovery;
- integrity-wrapped complete-world snapshot envelopes;
- deterministic snapshot generations and immediate parent IDs;
- payload SHA-256, snapshot identity, world-schema, reload, and canonical-hash validation;
- primary, backup, temp, and recovery-temp candidate inspection;
- highest-valid-generation selection;
- stable priority for identical candidate copies;
- fail-closed conflict handling when different valid snapshots claim the same highest generation;
- temp-file fsync;
- backup preservation;
- same-directory atomic primary replacement on the tested Ubuntu filesystem;
- directory fsync required by default;
- post-install primary verification;
- restartable recovery promotion;
- nine abrupt child-process exit tests using exit code 86;
- deterministic recovery after six save-stage exits;
- deterministic recovery after three recovery-promotion exits;
- corruption fallback from primary to backup;
- promotion of a valid higher-generation temp;
- rejection of invalid high-looking temp content;
- refusal to overwrite an existing store with no valid candidate;
- pending memory-compaction recovery after atomic snapshot load;
- canonical hash equality with memory disabled versus enabled.

GitHub Actions executed 67 tests on Node.js v22.23.2 and Ubuntu 24.04: 67 passed and 0 failed.

## Interpretation

The results support a process-exit-resilient, integrity-wrapped atomic snapshot protocol on the tested Linux CI filesystem.

They show that, after the tested process exits, at least one complete valid candidate remains available, the selector can identify the highest non-conflicting valid generation, and recovery can install and verify it as primary.

They also show that recovery does not trust filenames or claimed generations alone. Content integrity and canonical consistency are checked first.

The tests do not establish universal power-loss safety.

## Exact abrupt-exit boundary

Save exits:

- `AFTER_TEMP_WRITE`
- `AFTER_TEMP_FSYNC`
- `AFTER_BACKUP_RENAME`
- `AFTER_BACKUP_DIRECTORY_FSYNC`
- `AFTER_PRIMARY_RENAME`
- `AFTER_PRIMARY_DIRECTORY_FSYNC`

Recovery-promotion exits:

- `AFTER_RECOVERY_TEMP_FSYNC`
- `AFTER_RECOVERY_PRIMARY_RENAME`
- `AFTER_RECOVERY_DIRECTORY_FSYNC`

Each child process called `process.exit(86)`.

A later process recovered generation 2 with the expected actor state, world revision, and canonical hash.

### Critical distinction

`AFTER_TEMP_WRITE` occurs before file fsync.

Success at this test point means the file survived the tested abrupt process exit on GitHub's Ubuntu filesystem. It does not demonstrate survival under sudden power loss, kernel failure, storage-controller cache loss, or hardware failure.

The later fsync stages provide stronger tested ordering, but the suite still cannot simulate every layer between the operating system and persistent media.

## Selection boundary

Candidate selection is:

`highest valid generation wins`

Validation includes:

- JSON parse;
- envelope schema;
- generation;
- payload encoding;
- payload hash;
- deterministic snapshot ID;
- world reload;
- world schema;
- canonical hash.

Different valid snapshots with the same highest generation produce `SNAPSHOT_GENERATION_CONFLICT`.

Identical copies use stable role priority:

`primary -> temp -> recovery-temp -> backup`

The store does not yet validate the complete historical chain of parent snapshot IDs. It records and links the immediate parent only.

## Filesystem boundary

Observed on GitHub Actions Ubuntu 24.04:

- temp and recovery-temp file fsync;
- backup and primary same-directory rename;
- directory fsync;
- post-rename verification;
- restart after abrupt process exit.

Not established:

- Windows behavior;
- macOS behavior;
- every Linux filesystem;
- network or distributed filesystems;
- cross-device moves;
- storage-controller durability;
- sudden power loss;
- torn writes below the filesystem;
- directory fsync semantics on platforms that reject it.

Directory fsync is required by default. An unsupported platform fails closed unless the caller explicitly disables that requirement.

## Concurrency boundary

There is no single-writer lock, lease, fencing token, or compare-and-swap admission gate yet.

Two writers operating simultaneously could race before either sees the other's generation.

The same-generation conflict detector protects recovery from silently choosing between conflicting complete candidates. It does not prevent competing writers from creating that conflict.

## Transaction boundary

The complete serialized world includes scheduler queues, deferred mailboxes, memory journals, receipts, and canonical state.

However, the current API does not yet bind:

`world mutation -> checkpoint admission -> durable generation commit`

into one exclusive transaction.

Callers remain responsible for deciding when a world snapshot is coherent enough to save.

## Composition with memory recovery

Atomic snapshot validation calls `reloadWorld(payload)`.

A valid snapshot can therefore contain a pending memory-compaction journal. Loading deterministically completes or repairs that non-canonical journal using the existing rules.

The test shows that composition preserves canonical truth.

## Benchmark boundary

The existing scheduler/lifecycle benchmark does not measure atomic persistence, fsync latency, process-exit recovery, or compaction recovery.

The current persistence evidence is correctness and recovery evidence, not a throughput or latency claim.

## Next proof work

- deterministic single-writer lease or lock with stale-owner recovery;
- fencing token or compare-and-swap generation admission;
- checkpoint barrier spanning mutation, scheduler queue, deferred mailbox, and compaction journal;
- process-exit tests during lock acquisition and lock release;
- parent-chain verification and bounded lineage retention;
- platform matrix for Linux filesystems, Windows, and macOS;
- dedicated atomic persistence and recovery benchmarks;
- trusted external recovery when every local candidate is invalid;
- stronger process-signal and fault-injection tests;
- actual power-failure testing on controlled hardware where practical.

## Not proven

Do not claim that EchoWorld:

- is universally power-loss-safe;
- guarantees storage-controller durability;
- is portable across every filesystem;
- prevents simultaneous writers;
- verifies its complete snapshot lineage;
- provides a fully atomic world-mutation transaction;
- is cheaper than conventional engines;
- scales to massive persistent worlds;
- provides production multiplayer determinism;
- models realistic sound or fire propagation;
- handles genuine simultaneous cell execution;
- guarantees scheduler fairness;
- creates compelling emergent stories;
- contains independent parallel workers;
- contains AI;
- makes AI safe by itself.

Specialists remain proposal-only. Perception, compaction, deferred delivery, and persistence bookkeeping remain outside canonical rule authority. AI is not integrated in v0.01.
