# EchoWorld v0.01 Writer Lease, Fencing, and Checkpoint Admission

This document describes the cooperative single-writer protocol added in `chatgpt/echoworld-lane-01`.

## Purpose

Atomic snapshot recovery previously detected conflicting complete generations but did not prevent two cooperating writers from attempting to create them.

The new layer asks:

> Can local cooperating writers elect one time-bounded owner, issue monotonic fencing tokens, reject stale owners and stale bases, and bind a coherent world checkpoint to the durable generation it extends?

The current evidence answers **yes for the tested local Ubuntu filesystem protocol and API**.

It is not an operating-system lock, hostile-process sandbox, distributed consensus algorithm, or universal clock-safe lease.

## Record schemas

Lease claim:

`axm.echoworld.writer-lease-claim/v0.01`

Activation:

`axm.echoworld.writer-lease-activation/v0.01`

Heartbeat:

`axm.echoworld.writer-lease-heartbeat/v0.01`

Durable base record:

`axm.echoworld.writer-lease-base/v0.01`

Release:

`axm.echoworld.writer-lease-release/v0.01`

Lease handle:

`axm.echoworld.writer-lease-handle/v0.01`

Checkpoint admission:

`axm.echoworld.checkpoint-admission/v0.01`

Fenced snapshot envelope:

`axm.echoworld.atomic-snapshot/v0.02`

Legacy `axm.echoworld.atomic-snapshot/v0.01` remains readable.

## Append-only lease ledger

For store name `world`, lease evidence lives under:

```text
world.writer-lease/
  claims/
  activations/
  heartbeats/
  bases/
  releases/
```

Records are created with exclusive filenames, written with mode `0600`, fsynced, and followed by directory fsync.

Every record includes a deterministic SHA-256 `recordHash` over its stable identity fields.

The ledger is append-only in the current design. Tokens and old records are not reused.

## Fencing-token allocation

Claims use zero-padded filenames such as:

`claim-00000000000000000001.json`

A claimant scans allocated claim filenames, proposes the next integer token, and creates the file with exclusive-create semantics. If another claimant wins that filename first, allocation retries with the next observed token.

A corrupt or abandoned claim still burns its filename/token. It cannot become active because its schema and hash fail validation, but later allocations remain strictly monotonic.

## Provisional claim and activation

Acquisition has two expiry windows:

- provisional claim duration
- active lease duration

Protocol:

```text
inspect active owner
→ allocate append-only claim
→ fsync claim
→ elect lowest live provisional/active contender
→ winning claim writes activation
→ fsync activation
→ verify active ownership
→ recover durable snapshot base using its fencing policy
→ write durable base record
→ return lease handle
```

The lowest live contender rule resolves tested simultaneous cooperative acquisition. After activation, inspection treats the highest still-active fencing token as authoritative if contradictory active records ever exist, which fences lower tokens fail-closed.

A contender that loses election writes a release record with reason `LEASE_CONTENDED` and receives `WRITER_LEASE_CONTENDED`.

## Heartbeats and expiry

A heartbeat is an append-only sequence record for one lease token and lease ID.

The latest valid heartbeat extends `expiresAtMs`.

When the active lease expires, a new writer may allocate a higher token and take ownership. The old handle then fails with `WRITER_FENCED` when a newer active token exists, or `WRITER_LEASE_EXPIRED` when no replacement owns the lease yet.

Expiry uses caller-supplied millisecond time. Tests inject explicit values. This keeps the proof reproducible but does not establish distributed-clock safety.

## Durable base record

After activation, the writer recovers the current eligible atomic snapshot store and records:

- base generation
- base snapshot ID
- base canonical hash
- writer ID
- lease ID
- fencing token

The lease handle carries that base.

After a successful leased checkpoint, `nextLease` advances the base to the newly committed generation. Reusing the old base handle fails with `CHECKPOINT_BASE_CHANGED`.

## Checkpoint admission

The checkpoint barrier first inspects whether the world is quiescent enough to capture.

Default stable cell states:

- `DORMANT`
- `REPAIR`

Any other wake state causes `CHECKPOINT_BARRIER_REJECTED`.

The checkpoint includes:

```text
writerId
leaseId
fencingToken
admittedAtMs
admittedBaseGeneration
admittedBaseSnapshotId
worldRevision
canonicalHash
operationalHash
operationalCounts
checkpointId
```

`checkpointId` is deterministic over the admission fields.

## Operational checkpoint projection

The operational hash covers selected deterministic coordination evidence:

- seen event IDs
- seen causal-arrival keys
- scheduler job identity, base revision, status, queue identities, and causal bounds
- deferred mailbox ownership, event identities, retry counts, and expiry epochs
- pending compaction IDs, stages, generations, and before/after hashes
- cell wake state, activation count, and latest wake/sleep event IDs

The full serialized world payload remains separately protected by `payloadHash`.

The operational hash proves that the checkpoint admission was made against the same coordination projection later validated from the unrecovered payload. It is not intended to represent every byte of the world.

## Snapshot v0.02 integration

A v0.02 snapshot may contain a checkpoint admission.

Validation checks:

1. checkpoint schema and deterministic ID;
2. admitted base generation equals `generation - 1`;
3. admitted base snapshot ID equals `parentSnapshotId`;
4. checkpoint world revision matches the serialized world;
5. checkpoint canonical hash matches the serialized world;
6. checkpoint operational hash matches the unrecovered serialized coordination state;
7. payload and snapshot identity checks still pass;
8. normal non-canonical recovery may then run before the world is returned.

This ordering allows a snapshot to preserve a pending compaction journal exactly while still returning a repaired memory state after load.

## Leased checkpoint protocol

`saveLeasedAtomicWorldSnapshot()` performs:

```text
renew lease when configured
→ assert current owner
→ recover eligible durable base
→ compare base with lease handle
→ inspect quiescence barrier
→ create checkpoint admission
→ build v0.02 snapshot envelope
→ assert ownership around write boundaries
→ verify primary still matches admitted base before install
→ atomically install and verify next generation
→ return advanced lease base
```

Ownership is checked around:

- base recovery
- temp write
- temp fsync
- backup copy
- backup directory fsync
- primary rename
- primary directory fsync
- installed-primary verification

The check immediately before primary rename also reopens the current primary and verifies that its generation and snapshot ID still equal the admitted base.

## Fencing old transient candidates

A new writer uses a recovery candidate policy tied to its fencing token.

A `temp` or `recoveryTemp` candidate carrying a lower checkpoint fencing token is ineligible and reported as:

`FENCED_UNCOMMITTED_CANDIDATE`

Committed primary and backup candidates remain eligible because they are durable generations, not merely uncommitted transients.

If the store contains only fenced transient candidates and no committed snapshot, acquisition discards those transients and records an empty durable base.

This prevents the tested stale leased temp from being promoted after a higher token takes over.

## Release

The current owner may write an append-only release record. A later writer can acquire immediately with a higher fencing token.

A stale owner may also record a stale release, but it cannot release or overwrite the newer active lease because release identity is scoped to the old token and lease ID.

## Abrupt process-exit tests

Child processes exit with code `86` after durable lease stages:

- `AFTER_CLAIM_FSYNC`
- `AFTER_ACTIVATION_FSYNC`
- `AFTER_BASE_RECORD_FSYNC`
- `AFTER_RELEASE_FSYNC`

After claim/activation/base interruption, replacement acquisition succeeds after the provisional or active expiry and receives a higher token.

After durable release interruption, replacement acquisition succeeds immediately.

## Verified behaviors

The current tests establish:

- one active cooperative owner blocks another;
- simultaneous cooperative claims yield one active owner;
- release permits immediate higher-token ownership;
- heartbeat renewal extends ownership;
- stale takeover fences the old handle;
- corrupt burned claims cannot activate and do not break monotonic allocation;
- checkpoint admissions embed fence and durable-base evidence;
- successful checkpoints advance the lease base;
- stale base handles are rejected;
- stale owners cannot checkpoint after higher-token takeover;
- active cells fail the checkpoint barrier;
- operational hashes cover queues, mailboxes, pending compactions, ledgers, and activation evidence;
- checkpoint tampering invalidates snapshot identity;
- older leased temp candidates are fenced after takeover;
- lease expiry during save prevents primary installation at the tested boundary;
- a non-cooperating durable base change is detected;
- lease acquisition and release interruption are recoverable.

## Claim boundary

### Cooperative protocol

The proof applies to writers using the lease and leased-checkpoint APIs.

A hostile or buggy process with direct filesystem access can ignore the protocol. Filesystem permissions and operating-system isolation are separate responsibilities.

### Timing

Lease expiry uses supplied wall-clock-like milliseconds. The implementation does not yet solve:

- cross-machine clock skew
- NTP rollback
- suspended-process timing
- monotonic-clock persistence across restart
- distributed lease consensus

### Atomicity gap

Lease assertions happen at named write boundaries. There remains a small interval between the final pre-rename assertion and the rename operation itself. This is cooperative fencing, not a kernel-enforced compare-and-swap transaction.

### Ledger growth

Claims, activations, heartbeats, bases, and releases are append-only. No verified compaction, archival, or garbage-collection protocol exists yet.

### Lineage

The lease verifies and advances the immediate durable base. Complete parent-chain traversal and historical fencing audit are not yet implemented.

### Persistence

The earlier atomic persistence boundary remains: process-exit resilience on the tested Ubuntu filesystem is not universal sudden-power-loss or storage-controller proof.

## Next proof work

1. append-only lease-ledger checkpointing and safe archival;
2. monotonic-clock / clock-rollback handling;
3. a stronger persisted compare-and-swap or platform lock beneath cooperative fencing;
4. complete snapshot parent-chain and fencing-token lineage verification;
5. an explicit mutation session that freezes/adopts world state before checkpoint admission;
6. process-exit tests during heartbeat and checkpoint write boundaries;
7. hostile bypass and permission-boundary tests in a contained environment;
8. platform/filesystem matrix and power-failure experiments.
