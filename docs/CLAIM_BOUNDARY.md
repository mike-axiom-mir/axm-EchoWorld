# EchoWorld v0.01 Claim Boundary

## Observed in this lane

The current lane demonstrates a small deterministic persistent-cell harness with:

- stable cell identity and canonical revision state;
- bounded memory written only after successful truth commit;
- deterministic specialist matching and proposal receipts;
- stale specialist proposal rejection;
- deterministic preservation/rejection of contradictory specialist proposals without canonical mutation;
- bounded handoff generation with duplicate, cycle, hop-limit, and repeated-causal-arrival guards;
- deterministic queued handoff ordering;
- explicit processing and queue-capacity budgets;
- persisted unfinished scheduler jobs that resume after reload;
- canonical hash checks around scheduler execution;
- snapshot-shape validation and non-canonical state backfill;
- canonical hash equality with memory disabled versus enabled, including scheduler-enabled replay.

The local checkpoint is covered by 23 passing Node tests. The initial four-way scheduler order is checked across all 24 permutations.

A local scheduler microbenchmark receipt is stored in `evidence/scheduler-benchmark-latest.json`.

## Interpretation

These results support the architectural separation between canonical physical truth and experiential/advisory/scheduling layers for this small prototype.

They also show that a causal handoff wave can be drained in a deterministic bounded queue without directly changing canonical truth in the tested cases.

## Important limit

The scheduler propagates handoff envelopes only.

It does not yet prove the full cell-arrival lifecycle, autonomous world behavior, production networking, useful story emergence, or economical massive-world scaling.

The benchmark is a local wall-clock microbenchmark on one environment. It is not evidence of production performance.

## Next proof work

- recipient-cell wake/sleep and bounded perception processing for accepted handoffs;
- interruption-safe memory compaction;
- crash-safe atomic persistence and recovery;
- larger sleeping-world activation measurements;
- stronger long-stream/property tests;
- domain rules for combining non-identical signals without giving advisory layers truth authority;
- an external lineage strategy for queue-capacity overflow if lossless continuation is required.

## Not proven

Do not claim that EchoWorld:

- is cheaper than conventional engines;
- scales to massive persistent worlds;
- provides production multiplayer determinism;
- creates compelling emergent stories;
- safely resolves every conflicting physical proposal;
- contains independent parallel workers;
- contains AI;
- makes AI safe by itself.

Specialists remain proposal-only. Handoff scheduling remains non-canonical. AI is not integrated in v0.01.
