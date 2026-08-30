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
- wake -> bounded specialist proposals -> deterministic proposal merge gate -> canonical commit -> memory update -> handoff emission -> sleep ordering
- bounded working, episodic, compressed, and lineage memory
- deterministic memory importance and compaction receipts
- stale specialist proposal rejection
- deterministic conflict preservation/rejection for contradictory specialist proposals
- bounded handoff envelopes with duplicate, cycle, and hop-limit guards
- deterministic queued handoff scheduler
- deterministic coalescing of repeated arrivals from the same causal signal
- hard processing and queue-capacity budgets with explicit incomplete receipts
- persisted unfinished scheduler jobs that can resume after reload
- JSON persistence/reload with snapshot-shape validation and non-canonical state backfill
- memory-enabled vs memory-disabled A/B replay
- local scheduler microbenchmark receipt

## Authority boundary

Memory, specialists, handoff guards, scheduler jobs, and scheduler receipts are not physical truth authority.

A failed canonical transition creates no memory about an event that never committed.

Conflicting specialist proposals do not gain authority through worker finish order. They are preserved as deterministic conflicts and rejected from canonical mutation.

The handoff scheduler propagates bounded event envelopes only. It does not directly rewrite recipient-cell physical truth.

## Run

Requires Node.js 20+.

```bash
npm test
npm run benchmark
```

## Current evidence

The current lane-01 checkpoint was executed locally with Node.js v22.16.0:

- 23 tests
- 23 passed
- 0 failed

The scheduler-order test checks every permutation of the initial four-way queue.

GitHub Actions independently passed the implementation checkpoint:

- commit `f4e548904660cd4d9ecd2df687c934cbd47c2636`
- run `33336545874`
- conclusion `success`

See:

- `evidence/test-receipt-latest.json`
- `evidence/scheduler-benchmark-latest.json`

The benchmark is a local microbenchmark, not a production-scale claim.

## Not proven yet

- production-scale performance
- massive sleeping-world scaling
- full recipient-cell wake/perception/specialist processing for accepted handoffs
- crash-safe atomic durable storage
- interruption-safe memory compaction
- independent parallel specialist execution
- domain-specific canonical resolution for contradictory specialist proposals
- story quality or emergent-world value
- multiplayer/network determinism
- AI integration

No AI belongs in v0.01.
