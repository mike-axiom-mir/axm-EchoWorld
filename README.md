# AXM EchoWorld

EchoWorld is an experimental deterministic persistent-cell world harness.

**v0.01 question:** can small persistent world cells keep bounded memory and spawn only relevant temporary specialist work while canonical physical truth remains deterministic and unchanged by the experiential layer?

## Current lane

Implementation work is isolated to:

`chatgpt/echoworld-lane-01`

See `AGENTS.md` for the one-chat/one-lane rule.

## Implemented proof surface

- 16x16 default deterministic cell world
- stable cell IDs
- actors A and B
- a bridge structure
- canonical revision + SHA-256 truth hash
- deterministic MOVE / DAMAGE_STRUCTURE / FIRE rules
- truth-before-memory canonical event ordering
- bounded working, episodic, compressed, and lineage memory
- explicit `CANONICAL` versus `OBSERVED` memory provenance
- copy-on-write memory compaction with persisted before/after images and recovery
- explicit `REPAIR` state when a trusted memory before-image is corrupt
- deterministic specialist matching, stale rejection, and conflict preservation
- bounded handoff guards, deterministic scheduling, and explicit resource budgets
- accepted SOUND handoff recipient lifecycle: wake, specialists, perception, optional memory, relay, sleep
- bounded persistent deferred delivery for busy recipient cells
- exact-once deferred release with logical TTL, retry, deduplication, and receipts
- integrity-wrapped atomic snapshot persistence
- deterministic snapshot generations linked by `parentSnapshotId`
- primary, backup, temp, and recovery-temp candidate inspection
- highest-valid-generation recovery with fail-closed same-generation conflict detection
- temp-file fsync, backup preservation, atomic primary rename, directory fsync, and post-install verification
- abrupt child-process exit recovery at six save stages and three recovery-promotion stages
- automatic pending memory-compaction recovery after atomic snapshot load
- memory-enabled versus memory-disabled canonical equivalence
- local scheduler/lifecycle microbenchmark

## Authority boundary

Canonical physical truth contains world revision, actor positions, and cell physical state.

Memory, compaction journals, perception, wake state, specialists, handoff guards, scheduler jobs, deferred mailboxes, snapshot candidates, and persistence receipts do not gain physical truth authority merely by existing.

A failed canonical transition creates no memory about an event that never committed.

A handoff can create only an **OBSERVED** local memory after deterministic acceptance and recipient processing. It cannot promote itself into canonical truth.

Conflicting specialist proposals cannot gain authority through worker finish order.

Snapshot recovery validates payload integrity, world reloadability, world schema, and canonical hash. It chooses the highest valid generation. If two different valid snapshots claim the same highest generation, recovery stops with `SNAPSHOT_GENERATION_CONFLICT` instead of guessing.

## Atomic snapshot protocol

The store uses these files:

- `world.snapshot.json` for the primary
- `world.snapshot.backup.json` for the previous primary
- `world.snapshot.tmp.json` for a candidate write
- `world.snapshot.recover.tmp.json` for recovery promotion

Each envelope records:

- schema
- generation
- parent snapshot ID
- world schema
- canonical hash
- payload hash
- UTF-8 JSON payload
- deterministic snapshot ID

The tested save path is:

```text
validate/recover existing store
→ write temp
→ fsync temp
→ preserve previous primary as backup
→ fsync directory
→ atomically rename temp to primary
→ fsync directory
→ verify installed primary
```

The tested recovery path is:

```text
inspect primary + backup + temp + recovery-temp
→ validate every candidate
→ choose highest non-conflicting valid generation
→ copy selected candidate to synced recovery-temp
→ atomically rename recovery-temp to primary
→ fsync directory
→ verify promoted primary
```

## Run

Requires Node.js 20+.

```bash
npm test
npm run benchmark
```

## Current evidence

GitHub Actions independently executed the complete implementation suite on Node.js v22.23.2 and Ubuntu 24.04:

- 67 tests
- 67 passed
- 0 failed
- 0 cancelled
- 0 skipped
- implementation head `149b000183d23639bfb7d8926d942f92b095a310`
- run `33377190670`
- job `99441212943`
- merge ref `e1a61f0b3b8ccf965fe3015c0ec07d20d8848366`
- test duration `2025.432072 ms`
- conclusion `success`

The atomic persistence tests include nine abrupt child-process exits using exit code `86`:

- six save stages from temp write through primary directory fsync
- three recovery-promotion stages from recovery-temp fsync through recovery directory fsync

They also verify generation chaining, backup fallback, valid-temp promotion, invalid-temp rejection, payload tamper detection, deterministic identical-candidate priority, same-generation conflict refusal, refusal to overwrite a fully invalid store, and integration with pending memory-compaction recovery.

See:

- `docs/ATOMIC_PERSISTENCE.md`
- `evidence/test-receipt-latest.json`
- `evidence/atomic-snapshot-recovery-latest.json`
- `evidence/memory-compaction-recovery-latest.json`
- `evidence/scheduler-benchmark-latest.json`

## Honest boundary

This is a process-exit-resilient, integrity-wrapped atomic snapshot protocol on the tested Linux CI filesystem.

It is **not** proof of sudden power-loss durability. In particular, recovery after `AFTER_TEMP_WRITE` shows that a valid temp file survived the tested process exit. That stage had not yet completed file fsync and must not be described as power-loss-safe.

Still unproven:

- storage-controller or hardware cache durability
- behavior across every filesystem and operating system
- cross-device rename behavior
- multi-writer locking or writer-lease ownership
- a fully verified parent-chain lineage beyond the immediate parent ID
- one atomic transaction spanning scheduler queue, deferred mailbox, and compaction journal
- automatic reconstruction when every candidate is corrupt
- production-scale performance
- massive sleeping-world scaling
- physical attenuation and material-aware propagation
- genuine simultaneous cell execution
- scheduler fairness
- multiplayer/network determinism
- independent parallel specialist workers
- emergent-story quality
- AI integration

No AI belongs in v0.01.
