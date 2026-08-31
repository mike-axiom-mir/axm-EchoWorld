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
- deterministic memory importance and compaction receipts
- stale specialist proposal rejection
- deterministic conflict preservation/rejection for contradictory specialist proposals
- bounded handoff envelopes with duplicate, cycle, hop-limit, future-revision, and repeated-arrival guards
- deterministic queued handoff scheduler
- deterministic coalescing of repeated arrivals from the same causal signal
- hard processing and queue-capacity budgets with explicit incomplete receipts
- persisted unfinished scheduler jobs that can resume after reload
- recipient-cell lifecycle for accepted SOUND handoffs:
  - wake
  - event-relevant SOUND specialists
  - deterministic proposal merge gate
  - OBSERVED perception receipt
  - bounded perception memory when enabled
  - bounded relay handoffs
  - sleep
- committed-source lineage detection through `causalEventId + sourceRevision`
- direct lifecycle canonical-hash witness
- scheduler-level canonical-hash witness for batched lifecycle processing
- JSON persistence/reload with snapshot-shape validation and non-canonical state backfill
- memory-enabled vs memory-disabled A/B replay
- envelope-only vs lifecycle/no-memory vs lifecycle/with-memory local microbenchmark

## Authority boundary

Memory, perception, wake state, specialists, handoff guards, scheduler jobs, and scheduler receipts are not physical truth authority.

A failed canonical transition creates no memory about an event that never committed.

A handoff can create only an **OBSERVED** local memory after its guard accepts it. That memory retains causal provenance and cannot promote itself into canonical truth.

Conflicting specialist proposals do not gain authority through worker finish order. They are preserved as deterministic conflicts and rejected from canonical mutation.

The recipient lifecycle may wake, interpret, remember, relay, and sleep. It does not directly rewrite recipient-cell physical truth.

## Run

Requires Node.js 20+.

```bash
npm test
npm run benchmark
```

## Current evidence

The current lane-01 checkpoint was executed locally with Node.js v22.16.0:

- 31 tests
- 31 passed
- 0 failed

GitHub Actions independently passed the recipient-lifecycle implementation checkpoint:

- commit `7e41fab8b9b9f7972e7ff01a20e7e01850c962f8`
- run `33346932247`
- conclusion `success`

The scheduler-order test checks every permutation of the initial four-way queue.

The v0.02 local benchmark compares:

- envelope propagation only
- recipient lifecycle with memory disabled
- recipient lifecycle with memory enabled

Its timings are noisy single-machine observations, not evidence that lifecycle processing is free or faster.

See:

- `evidence/test-receipt-latest.json`
- `evidence/scheduler-benchmark-latest.json`

## Not proven yet

- production-scale performance
- massive sleeping-world scaling
- physical sound attenuation or material-aware propagation
- simultaneous/concurrent arrival handling
- busy-cell retry/deferred delivery
- crash-safe atomic durable storage
- interruption-safe memory compaction
- independent parallel specialist execution
- domain-specific canonical resolution for contradictory specialist proposals
- story quality or emergent-world value
- multiplayer/network determinism
- AI integration

No AI belongs in v0.01.
