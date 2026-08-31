# AXM EchoWorld

EchoWorld is an experimental deterministic persistent-cell world harness.

**v0.01 question:** can small persistent world cells retain bounded experience and spawn only relevant temporary specialist work while canonical physical truth remains deterministic, replayable, and protected from experiential authority?

## Current lane

Implementation work remains isolated to:

`chatgpt/echoworld-lane-01`

See `AGENTS.md` for the one-chat/one-lane rule.

## Implemented proof surface

- deterministic 16x16 default world with stable cell IDs
- canonical MOVE / DAMAGE_STRUCTURE / FIRE rules and SHA-256 truth hash
- truth-before-memory ordering
- bounded `CANONICAL` and `OBSERVED` memory with provenance-aware compaction
- deterministic temporary specialist proposals, stale rejection, and conflict preservation
- bounded handoff guards, queued scheduling, resource budgets, and replay evidence
- accepted SOUND handoff lifecycle: wake, specialists, perception, optional memory, relay, sleep
- persistent deferred delivery for simulated busy cells
- interruption-safe copy-on-write memory compaction and explicit `REPAIR`
- integrity-wrapped atomic complete-world snapshots
- primary / backup / temp / recovery-temp candidate inspection
- process-exit recovery across save and recovery-promotion stages
- append-only single-writer lease records
- monotonic fencing tokens
- provisional claims, activation, heartbeat renewal, base records, and durable release records
- stale-owner takeover after lease expiry
- checkpoint admission bound to writer ID, lease ID, fencing token, durable base, canonical hash, and operational hash
- operational checkpoint evidence for scheduler queues, deferred mailboxes, pending compactions, seen ledgers, and cell activation state
- legacy atomic snapshot v0.01 validation plus fenced snapshot v0.02
- fencing-aware rejection of older leased temp/recovery-temp candidates
- current-owner checks at persistence authority boundaries
- stale-base rejection before primary installation
- crash-tested lease acquisition and release recovery

## Core authority boundary

Canonical physical truth contains world revision, actor positions, and cell physical state.

Memory, perception, wake state, specialists, handoff guards, scheduler jobs, deferred mailboxes, compaction journals, lease records, fencing tokens, checkpoint receipts, candidate filenames, and persistence receipts do not become physical truth authority merely by existing.

A failed canonical transition creates no canonical memory. An accepted handoff may create only an `OBSERVED` memory. Specialist finish order cannot grant mutation authority.

A snapshot is accepted only when its payload integrity, deterministic identity, world schema, canonical hash, and optional checkpoint admission all validate.

## Cooperative single-writer protocol

A writer first acquires an append-only claim with a monotonic fencing token. The winning claim activates a time-bounded lease and records the durable snapshot base it observed.

A leased checkpoint then follows:

```text
acquire / renew lease
→ verify current owner and expected durable base
→ inspect checkpoint barrier
→ create deterministic checkpoint admission
→ write fenced temp snapshot
→ re-check lease at write boundaries
→ verify primary still matches admitted base
→ atomically install and verify next generation
```

Checkpoint admissions include:

- `writerId`
- `leaseId`
- `fencingToken`
- admitted base generation and snapshot ID
- world revision
- canonical hash
- operational hash and counts
- deterministic checkpoint ID

A higher fencing token makes an older **leased** temp or recovery-temp ineligible for recovery promotion. A stale lease cannot use the leased checkpoint API after takeover.

## Checkpoint barrier

By default, a checkpoint is admitted only when every cell is in `DORMANT` or explicit `REPAIR` state.

The operational hash covers selected deterministic coordination projections for:

- active scheduler queues
- deferred mailboxes
- pending memory-compaction journals
- seen handoff/event ledgers
- cell wake and activation evidence

The complete world payload remains protected separately by its payload SHA-256. The operational hash is a coordination witness, not a replacement for the full payload hash.

## Run

Requires Node.js 20+.

```bash
npm test
npm run benchmark
```

## Current evidence

GitHub Actions independently executed the implementation head on Node.js v22.23.2 and Ubuntu 24.04:

- **85 tests**
- **85 passed**
- **0 failed**
- **0 cancelled**
- **0 skipped**
- implementation head `6455d5dd4dc2d0609ab13ca38e096ca2fee63fc9`
- run `33405590474`
- job `99532258471`
- merge ref `bc2ac474b60bd91e3574e5e597c44d1287c5113b`
- test duration `2086.800059 ms`
- conclusion `success`

The 18 new writer/checkpoint tests verify active-owner exclusion, simultaneous cooperative acquisition, monotonic tokens, renewal, stale takeover, durable release, base advancement, stale-base rejection, checkpoint quiescence, operational hashing, checkpoint tamper detection, fencing of older leased temps, mid-save lease expiry, non-cooperating base-change detection, and process-exit recovery at lease claim/activation/base/release stages.

See:

- `docs/WRITER_LEASE.md`
- `docs/ATOMIC_PERSISTENCE.md`
- `evidence/writer-lease-fencing-latest.json`
- `evidence/test-receipt-latest.json`
- `evidence/atomic-snapshot-recovery-latest.json`
- `evidence/memory-compaction-recovery-latest.json`

## Honest boundary

This is a **cooperative local-filesystem writer-fencing proof** on the tested Ubuntu CI environment.

It does not prove that a hostile or buggy process bypassing the lease API cannot edit snapshot files directly. A durable-base check detects tested non-cooperating base changes before leased primary installation, but it is not an operating-system security boundary.

Lease expiry currently depends on supplied millisecond time. Tests use explicit deterministic values, but cross-machine clock skew, clock rollback, suspended processes, and distributed lease semantics remain unproven.

Append-only claim, heartbeat, base, and release records currently have no garbage-collection or archival protocol.

Also unproven:

- sudden power-loss and storage-controller durability
- every filesystem and operating system
- network filesystem or cross-device rename semantics
- hostile multi-process enforcement
- fully atomic in-memory mutation plus durable checkpoint commit
- complete parent-chain verification
- external recovery when all local candidates are corrupt
- production-scale performance and massive-world scaling
- realistic physical propagation
- genuine concurrent cell execution and scheduler fairness
- multiplayer/network determinism
- independent parallel specialist workers
- emergent-story quality
- AI integration

No AI belongs in v0.01.
