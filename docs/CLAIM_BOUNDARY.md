# EchoWorld v0.01 Claim Boundary

## Observed in this lane

The current lane demonstrates a small deterministic persistent-cell harness with:

- stable canonical world state and hashing;
- bounded CANONICAL and OBSERVED memory;
- temporary specialist proposals with deterministic authority limits;
- bounded handoff scheduling and deferred delivery;
- interruption-safe memory compaction;
- process-exit-resilient atomic snapshots on the tested Ubuntu filesystem;
- append-only writer lease records with integrity hashes;
- monotonically increasing fencing tokens;
- provisional claims, activation, heartbeat renewal, durable base records, and release records;
- one active cooperative owner blocking another;
- simultaneous cooperative claims electing one active owner in the tested race;
- stale-owner takeover after expiry with a higher fencing token;
- old lease handles rejected after takeover;
- deterministic checkpoint admissions containing writer, lease, token, durable base, canonical, and operational evidence;
- quiescence rejection for active cells;
- leased snapshots embedding checkpoint evidence in atomic snapshot v0.02;
- stale durable-base rejection;
- reassertion of lease ownership at named persistence boundaries;
- base identity verification before primary installation;
- fencing-aware rejection of older leased temp and recovery-temp candidates;
- detection of a tested non-cooperating durable-base change;
- process-exit recovery after durable claim, activation, base, and release stages;
- legacy snapshot v0.01 compatibility;
- 85 passing GitHub Actions tests.

## Interpretation

The evidence supports a cooperative local single-writer protocol layered over the existing atomic snapshot store.

Within the tested API:

- one current lease owns checkpoint admission;
- every replacement receives a strictly higher fencing token;
- a stale handle cannot perform a leased checkpoint after takeover;
- a checkpoint is bound to the durable generation it extends;
- selected operational coordination state is included in the admission witness;
- an older leased transient cannot later outrank the new writer's durable base merely because its generation is higher.

The evidence does not establish hostile-process exclusion, distributed consensus, universal clock correctness, or a kernel-enforced compare-and-swap transaction.

## Cooperative-writer boundary

The protocol applies to writers that use:

- `acquireWriterLease()`
- `renewWriterLease()`
- `assertWriterLease()`
- `saveLeasedAtomicWorldSnapshot()`
- `releaseWriterLease()`

A process with direct write access to the snapshot directory can bypass these calls.

The leased checkpoint detects the tested case where a non-cooperating writer changes the durable primary before admission/install. It cannot guarantee detection if an external process edits files after the final base assertion or tampers with the lease ledger itself.

Filesystem permissions, process isolation, and hostile-writer defense remain separate layers.

## Fencing boundary

Fencing tokens are monotonic append-only integers derived from exclusive claim filenames.

The implementation proves:

- tokens are not reused;
- corrupt claims cannot activate;
- replacement writers receive higher tokens;
- old lease handles fail after a higher active token appears;
- lower-token leased temp/recovery-temp candidates are ineligible under the new writer's candidate policy.

The policy deliberately does not reject committed primary/backup generations solely because their checkpoint token is old. They are durable history and may be the correct base.

Legacy uncheckpointed transient snapshots contain no fencing token and are not retroactively classified as stale leased candidates.

## Lease-time boundary

Lease expiry uses caller-supplied finite milliseconds.

Tests inject exact values, but the design does not yet prove safety under:

- clock rollback
- NTP correction
- cross-machine clock skew
- process suspension
- VM pause/resume
- restart without monotonic-clock continuity
- distributed hosts lacking a shared time authority

The lease is therefore a local cooperative timing protocol, not a distributed lease theorem.

## Election boundary

Simultaneous cooperative acquisition is tested with two Promise-based contenders on one local filesystem.

Exclusive claim creation and deterministic contender election produced one active writer.

The current result does not establish fairness under arbitrary process scheduling, large contender counts, network filesystems, or hostile claim-file manipulation.

## Checkpoint boundary

The default barrier rejects cells outside `DORMANT` or `REPAIR`.

The operational hash includes selected deterministic projections of:

- scheduler queues
- deferred mailboxes
- pending compaction journals
- seen event/arrival ledgers
- cell wake and activation evidence

The complete payload is separately hashed. The operational hash is not a full duplicate hash of every world byte.

The checkpoint API verifies admission state during envelope creation and validation. It does not freeze arbitrary caller mutation throughout the complete asynchronous save. A stronger mutation-session or immutable snapshot handoff remains future work.

## Persistence-boundary checks

Lease ownership is reasserted at named save boundaries, and primary base identity is checked immediately before rename.

There remains an interval between the final assertion and the filesystem rename. The implementation does not provide a kernel-level atomic condition such as “rename only if this lease token and primary identity are still current.”

A stronger compare-and-swap, platform lock, or directory-owner primitive remains unproven.

## Lease-ledger boundary

Lease records are append-only:

- claims
- activations
- heartbeats
- base records
- releases

No verified garbage collection, compaction, archival, bounded-retention, or full audit-chain protocol exists yet.

A long-running store will accumulate records.

## Process-exit boundary

New process-exit tests cover:

- `AFTER_CLAIM_FSYNC`
- `AFTER_ACTIVATION_FSYNC`
- `AFTER_BASE_RECORD_FSYNC`
- `AFTER_RELEASE_FSYNC`

Replacement acquisition succeeds after the tested expiry/release conditions.

These tests use `process.exit(86)` on GitHub Actions Ubuntu. They do not establish sudden power-loss or hardware-cache durability.

The previous atomic snapshot process-exit boundary remains unchanged.

## Snapshot lineage boundary

A snapshot records its immediate parent ID, and a leased checkpoint records the base it admitted.

The system does not yet traverse the complete parent graph, verify every historical fencing transition, retain an unbounded lineage, or detect deletion of older valid generations beyond the candidates currently stored.

## Authority boundary

Writer coordination may reject a checkpoint. It may not:

- change canonical physics;
- promote memory or perception into truth;
- resolve specialist proposals as physical state;
- rewrite causal history;
- grant itself new world authority.

Lease records, fencing tokens, checkpoint IDs, and operational hashes are excluded from canonical physical truth.

## Current evidence

GitHub Actions implementation checkpoint:

- code head `6455d5dd4dc2d0609ab13ca38e096ca2fee63fc9`
- run `33405590474`
- job `99532258471`
- merge ref `bc2ac474b60bd91e3574e5e597c44d1287c5113b`
- Node.js v22.23.2
- Ubuntu 24.04.4
- 85 tests
- 85 passed
- 0 failed
- duration `2086.800059 ms`

## Next proof work

- append-only lease-ledger checkpointing, archival, and bounded retention;
- monotonic-clock source and rollback-resistant expiry evidence;
- process-exit tests during heartbeat write and leased snapshot authority boundaries;
- stronger platform lock or persisted compare-and-swap beneath the cooperative protocol;
- immutable mutation session / checkpoint freeze semantics;
- complete parent-chain and fencing-transition verification;
- high-contention and fairness tests;
- operating-system and filesystem matrix;
- controlled sudden-power-loss experiments;
- external recovery when every local snapshot candidate is invalid;
- dedicated lease/checkpoint performance and storage-growth benchmarks.

## Not proven

Do not claim that EchoWorld:

- excludes hostile raw filesystem writers;
- implements distributed consensus;
- has clock-skew-safe distributed leases;
- provides kernel-enforced compare-and-swap installation;
- freezes all caller mutation during save;
- bounds lease-ledger storage growth;
- verifies complete snapshot/fencing lineage;
- is universally power-loss-safe;
- is portable across every filesystem;
- is production-scale or massive-world proven;
- provides realistic physical propagation;
- provides production multiplayer determinism;
- guarantees scheduler fairness or genuine parallel cell execution;
- contains independent parallel specialist workers;
- creates compelling emergent stories;
- contains AI;
- makes AI safe by itself.

No AI is integrated in v0.01.
