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
- copy-on-write memory compaction with a persisted before/after journal
- automatic recovery of pending compaction during reload
- deterministic recovery from interruption after prepare, working swap, compressed swap, or commit-receipt write
- rollback to the complete before-image when the after-image is corrupt
- explicit `REPAIR` state when the before-image cannot be trusted
- idempotent recovery and one final commit receipt per compaction
- provenance-aware summaries that never merge CANONICAL and OBSERVED records
- stale specialist proposal rejection
- deterministic conflict preservation/rejection for contradictory specialist proposals
- bounded handoff envelopes with duplicate, cycle, hop-limit, future-revision, and repeated-arrival guards
- deterministic queued handoff scheduler
- hard processing, queue, mailbox, retry, and logical-TTL budgets
- persisted unfinished scheduler jobs and deferred mailboxes
- accepted SOUND handoff recipient lifecycle: wake, bounded specialists, deterministic merge, OBSERVED perception, optional memory, relay, sleep
- committed-source lineage detection through `causalEventId + sourceRevision`
- exact-once deferred delivery after a busy cell becomes `DORMANT`
- direct lifecycle and scheduler-batch canonical-hash witnesses
- JSON persistence/reload with snapshot-shape validation and non-canonical state backfill
- memory-enabled vs memory-disabled A/B replay
- envelope-only vs lifecycle/no-memory vs lifecycle/with-memory local microbenchmark

## Authority boundary

Memory, compaction journals, perception, wake state, specialists, handoff guards, scheduler jobs, deferred mailboxes, and scheduler receipts are not physical truth authority.

A failed canonical transition creates no memory about an event that never committed.

A handoff can create only an **OBSERVED** local memory after its guard accepts it. That memory retains causal provenance and cannot promote itself into canonical truth.

A valid handoff aimed at a busy cell is inspected but not accepted. Until release, it is not added to the seen ledger and creates no lifecycle, perception, specialist, or memory receipt.

Compaction stores complete before and after images plus hashes before swapping either array. Recovery may finish a recognized interrupted swap, or restore the valid before-image when the proposed after-image is corrupt. If the before-image is corrupt, the cell enters `REPAIR`; EchoWorld does not guess which memory was real.

Conflicting specialist proposals do not gain authority through worker finish order. They are preserved as deterministic conflicts and rejected from canonical mutation.

## Interruption-safe compaction

The tested interruption points are:

- `AFTER_PREPARE`
- `AFTER_WORKING_SWAP`
- `AFTER_COMPRESSED_SWAP`
- `AFTER_COMMIT_RECEIPT`

A pending journal survives `persistWorld()` and is inspected automatically by `reloadWorld()`.

Recognized partial states roll forward to the deterministic after-image. A corrupt after-image rolls back to the complete before-image. A corrupt before-image fails closed in `REPAIR` with the journal retained for explicit repair.

This is interruption-safe recovery inside the JSON snapshot model. It is **not** yet crash-atomic filesystem persistence.

## Run

Requires Node.js 20+.

```bash
npm test
npm run benchmark
```

## Current evidence

GitHub Actions independently executed the complete implementation suite on Node.js v22.23.2:

- 49 tests
- 49 passed
- 0 failed
- implementation head `0d0050a2323f2775093bf8eed3c0df5e6492ffc7`
- run `33374326936`
- job `99432286023`
- conclusion `success`
- test duration `761.555682 ms`

The nine compaction checks cover normal copy-on-write commit, all four interruption points, idempotent recovery, corrupt-after rollback, corrupt-before repair lock, and provenance separation.

See:

- `evidence/test-receipt-latest.json`
- `evidence/memory-compaction-recovery-latest.json`
- `evidence/scheduler-benchmark-latest.json`

The benchmark remains a noisy single-machine timing sample. Compaction recovery performance has not been benchmarked.

## Not proven yet

- crash-atomic durable filesystem storage
- atomic queue/mailbox/compaction persistence under process or power loss
- production-scale performance
- massive sleeping-world scaling
- physical sound attenuation or material-aware propagation
- genuine simultaneous/concurrent cell execution
- fairness across unrelated scheduler jobs competing for one cell
- corrupted-before automatic reconstruction without an external trusted source
- independent parallel specialist execution
- domain-specific canonical resolution for contradictory specialist proposals
- story quality or emergent-world value
- multiplayer/network determinism
- lossless recovery of mailbox or queue capacity overflow
- AI integration

No AI belongs in v0.01.
