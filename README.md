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
- bounded persistent deferred-delivery mailboxes for busy recipient cells
- deterministic deferred release order
- logical-epoch TTL and retry limits
- explicit mailbox-capacity, expiry, and retry-exhaustion receipts
- deferred signals remain unaccepted and create no perception or memory until actual delivery
- direct lifecycle canonical-hash witness
- scheduler-level canonical-hash witness for batched lifecycle processing
- JSON persistence/reload with snapshot-shape validation and non-canonical state backfill
- memory-enabled vs memory-disabled A/B replay
- envelope-only vs lifecycle/no-memory vs lifecycle/with-memory local microbenchmark

## Authority boundary

Memory, perception, wake state, specialists, handoff guards, scheduler jobs, deferred mailboxes, and scheduler receipts are not physical truth authority.

A failed canonical transition creates no memory about an event that never committed.

A handoff can create only an **OBSERVED** local memory after its guard accepts it. That memory retains causal provenance and cannot promote itself into canonical truth.

A valid handoff aimed at a busy cell is inspected but not accepted. It enters a bounded deferred mailbox instead. Until release and actual acceptance, it is not added to the seen ledger and creates no lifecycle, perception, specialist, or memory receipt.

Conflicting specialist proposals do not gain authority through worker finish order. They are preserved as deterministic conflicts and rejected from canonical mutation.

The recipient lifecycle may wake, interpret, remember, relay, and sleep. It does not directly rewrite recipient-cell physical truth.

## Deferred delivery

Deferred delivery is controlled by three explicit per-scheduler limits:

- `maxMailboxSize`
- `maxDeferredRetries`
- `deferredTtlEpochs`

The TTL uses deterministic scheduler-drain epochs, not wall-clock time. A deferred signal may be released only when its recipient is `DORMANT` and queue capacity exists.

Possible scheduler states include:

- `WAITING_FOR_DEFERRED_DELIVERY`
- `DEFERRED_DELIVERY_EXHAUSTED`
- `BUDGET_EXHAUSTED`
- `DRAINED`
- `AUTHORITY_BREACH`

Mailbox overflow, expiry, and retry exhaustion are explicit failures. They cannot masquerade as successful delivery.

## Run

Requires Node.js 20+.

```bash
npm test
npm run benchmark
```

## Current evidence

GitHub Actions independently executed the complete current suite on Node.js v22.23.2:

- 40 tests
- 40 passed
- 0 failed
- commit `7492bbf17626e467ee4efe783e55f5fae1c9cd24`
- run `33348537317`
- conclusion `success`

The scheduler-order test checks every permutation of the initial four-way queue. The deferred-delivery tests additionally cover exact-once release, global deferred deduplication, deterministic release order, TTL expiry, retry exhaustion, mailbox overflow, invalid-signal rejection before deferral, and persistence/reload.

The v0.02 local benchmark compares:

- envelope propagation only
- recipient lifecycle with memory disabled
- recipient lifecycle with memory enabled

Its timings are noisy single-machine observations, not evidence that lifecycle processing is free or faster. Deferred-mailbox performance has not yet been benchmarked.

See:

- `evidence/test-receipt-latest.json`
- `evidence/scheduler-benchmark-latest.json`

## Not proven yet

- production-scale performance
- massive sleeping-world scaling
- physical sound attenuation or material-aware propagation
- genuine simultaneous/concurrent cell execution
- fairness across unrelated scheduler jobs competing for one cell
- crash-safe atomic durable storage
- interruption-safe memory compaction
- independent parallel specialist execution
- domain-specific canonical resolution for contradictory specialist proposals
- story quality or emergent-world value
- multiplayer/network determinism
- lossless recovery of mailbox or queue capacity overflow
- AI integration

No AI belongs in v0.01.
