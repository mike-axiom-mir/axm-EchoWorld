# AXM EchoWorld

EchoWorld is an experimental deterministic persistent-cell world harness.

**v0.01 question:** can small persistent world cells keep bounded memory and spawn only relevant temporary specialist work while canonical physical truth remains deterministic and unchanged by the experiential layer?

## Current lane

Implementation work is isolated to:

`chatgpt/echoworld-lane-01`

See `AGENTS.md` for the one-chat/one-lane rule.

## Implemented in the first proof

- 16x16 deterministic cell world
- stable cell IDs
- actors A and B
- a bridge structure
- canonical revision + SHA-256 truth hash
- deterministic MOVE / DAMAGE_STRUCTURE / FIRE events
- wake -> bounded specialist proposal receipts -> deterministic proposal merge gate -> canonical commit -> memory update -> handoff receipt -> sleep ordering
- bounded working, episodic, compressed, and lineage memory
- deterministic memory importance score
- memory compaction receipts
- event-relevant specialist matcher
- stale specialist proposal rejection
- deterministic conflict preservation/rejection for contradictory specialist proposals
- bounded neighbor handoff receipts
- duplicate handoff rejection
- causal-path cycle rejection
- hop-limit enforcement
- explicit bounded handoff propagation step
- JSON persistence/reload
- memory-enabled vs memory-disabled A/B replay

## Hard invariant

Memory and specialists are not physical truth authority.

A failed canonical transition must create no memory about an event that never committed.

Conflicting specialist proposals do not gain authority through worker finish order. In v0.01 they are preserved as a deterministic conflict and rejected from canonical mutation.

## Run

Requires Node.js 20+.

```bash
npm test
```

## Current evidence

The hardened lane-01 implementation was executed with Node.js v22.16.0:

- 13 tests
- 13 passed
- 0 failed

GitHub Actions independently passed the same deterministic harness on the hardened code checkpoint.

See `evidence/test-receipt-latest.json` for the explicit claim boundary and CI witness.

## Not proven yet

- production-scale performance
- large sleeping-world scaling
- full queued world propagation scheduler
- crash-safe durable persistence
- independent/parallel specialist execution
- domain-specific resolution policy for contradictory specialist proposals
- story quality or emergent-world value
- AI integration

No AI belongs in v0.01.
