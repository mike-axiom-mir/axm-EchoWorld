# EchoWorld v0.01 Architecture

The harness keeps canonical physical truth separate from experiential, advisory, perception, activation, scheduling, memory maintenance, persistence, and writer-coordination state.

## Canonical event lifecycle

```text
event
→ validate
→ wake affected cells
→ bounded relevant specialist proposals
→ deterministic proposal merge gate
→ explicit canonical rule + commit
→ truth receipt
→ bounded CANONICAL memory
→ journaled compaction when needed
→ bounded handoff emission
→ sleep
```

Only the explicit canonical rule changes physical truth.

## Recipient handoff lifecycle

```text
accepted SOUND arrival
→ wake recipient
→ relevant temporary specialists
→ deterministic proposal merge
→ OBSERVED perception receipt
→ optional bounded OBSERVED memory
→ journaled compaction when needed
→ bounded relay handoffs
→ sleep
```

Recipient processing does not advance world revision or directly rewrite cell physical truth.

## Busy-cell deferred delivery

```text
inspect valid arrival
→ detect non-DORMANT recipient
→ persist in bounded mailbox before acceptance
→ retry on logical scheduler epoch
→ release only when DORMANT and queue capacity exists
→ accept exactly once
→ run recipient lifecycle
```

A waiting handoff is not marked seen and creates no perception, specialist, lifecycle, or memory effect.

## Interruption-safe memory compaction

```text
prepare complete before/after images + hashes
→ swap working
→ swap compressed
→ write final receipt
→ advance generation
→ clear journal
```

Reload recognizes tested mixed states and rolls forward. A corrupt proposed after-image rolls back to the valid before-image. A corrupt before-image enters explicit `REPAIR`.

Compaction is non-canonical and preserves `CANONICAL` versus `OBSERVED` provenance.

## Atomic snapshot persistence

The store wraps the complete serialized world in an integrity envelope with generation, immediate parent, payload hash, canonical hash, optional checkpoint admission, and deterministic snapshot ID.

Recovery inspects primary, backup, temp, and recovery-temp and selects the highest eligible valid generation. Different valid identities at the same highest generation fail closed.

Save and recovery use synced temporary files, same-directory rename, directory fsync, and post-install verification on the tested Ubuntu filesystem.

## Writer lease architecture

Writer coordination is a separate append-only filesystem ledger:

```text
claim
→ activation
→ optional heartbeats
→ durable base record
→ leased checkpoint(s)
→ release or expiry
```

Each claim receives a monotonically increasing fencing token from an exclusive filename. A corrupt or abandoned claim burns its token but cannot activate.

The active lease is time-bounded. Heartbeats extend it. After expiry, a new writer may acquire a strictly higher token. Old handles then fail lease assertion.

The current protocol is cooperative. It does not prevent a process with raw filesystem access from bypassing the lease API.

## Checkpoint barrier and admission

The default barrier admits only cells in:

- `DORMANT`
- `REPAIR`

It rejects transient active states.

A checkpoint admission binds:

- writer ID
- lease ID
- fencing token
- durable base generation and snapshot ID
- world revision
- canonical hash
- operational hash and counts
- deterministic checkpoint ID

The operational projection covers selected coordination evidence from scheduler queues, deferred mailboxes, pending compactions, seen ledgers, and cell activation state.

The full payload hash still protects the complete serialized world. Operational hash is a focused checkpoint-coherence witness.

## Leased checkpoint lifecycle

```text
acquire or renew current lease
→ recover fencing-eligible durable base
→ compare durable base with lease handle
→ inspect quiescence barrier
→ create checkpoint admission
→ create snapshot v0.02
→ reassert lease at persistence boundaries
→ verify primary still equals admitted base
→ install and verify next generation
→ advance lease base
```

Reusing a pre-commit lease base fails with `CHECKPOINT_BASE_CHANGED`.

A higher token makes older leased `temp` and `recoveryTemp` candidates ineligible. Committed primary and backup generations remain eligible.

## Persistence authority checks

The leased wrapper asserts ownership around:

- recovered-base boundary
- temp write and fsync
- backup copy and directory fsync
- primary rename
- primary directory fsync
- installed-primary verification

Immediately before primary rename it also reopens primary and verifies generation and snapshot ID against the admitted base.

This narrows stale-writer risk, but the assertion and rename are not one kernel-enforced compare-and-swap operation.

## Snapshot validation order

For v0.02:

1. parse and validate envelope identity;
2. validate checkpoint schema and base relation;
3. load the unrecovered world;
4. compare world schema and canonical hash;
5. compare checkpoint world revision, canonical hash, and operational hash;
6. run normal non-canonical world recovery;
7. verify recovered canonical hash remains unchanged.

This allows exact checkpoint evidence for pending compaction state while still returning repaired memory.

Legacy v0.01 snapshots remain readable but contain no fencing checkpoint.

## Authority map

### Canonical authority

- deterministic physical event rules
- canonical world revision and state
- canonical hash

### Proposal / experiential authority only

- memory and perception
- specialists and merge receipts
- handoff and scheduler state
- deferred mailboxes
- compaction journals and repair state

### Persistence / coordination authority only

- snapshot candidate selection
- generations and immediate parent IDs
- lease claims, heartbeats, releases, and fencing tokens
- checkpoint admissions
- atomic save/recovery receipts

Coordination state may permit or reject a write. It does not define physical truth.

## Current evidence

Implementation head `6455d5dd4dc2d0609ab13ca38e096ca2fee63fc9` passed GitHub Actions run `33405590474`, job `99532258471`:

- 85 tests
- 85 passed
- 0 failed
- Node.js v22.23.2
- Ubuntu 24.04.4
- duration `2086.800059 ms`

## Remaining architectural boundaries

- cooperative API, not hostile filesystem enforcement
- supplied millisecond clock, not distributed monotonic time
- append-only lease ledger without verified archival
- immediate-parent validation, not complete lineage proof
- no atomic kernel CAS between final assertion and rename
- checkpoint admission does not freeze arbitrary caller mutation for the entire save
- process-exit evidence is not universal power-loss evidence
- no every-platform/filesystem proof
- no production-scale performance claim
- no AI in v0.01
