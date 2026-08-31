# EchoWorld v0.01 Claim Boundary

## Observed in this lane

The current lane demonstrates a small deterministic persistent-cell harness with:

- stable cell identity and canonical revision state;
- bounded memory written only after valid source boundaries;
- CANONICAL versus OBSERVED memory provenance;
- deterministic specialist matching and proposal receipts;
- stale specialist proposal rejection;
- deterministic preservation/rejection of contradictory specialist proposals without canonical mutation;
- bounded handoff generation with duplicate, cycle, hop-limit, future-revision, and repeated-causal-arrival guards;
- deterministic queued handoff ordering;
- explicit processing and queue-capacity budgets;
- persisted unfinished scheduler jobs that resume after reload;
- accepted SOUND handoffs waking recipient cells;
- event-relevant temporary SOUND specialists;
- deterministic proposal merge at the recipient;
- bounded observed perception memory;
- bounded relay handoffs;
- recipient cells sleeping again after processing;
- direct per-lifecycle and scheduler-batch canonical hash witnesses;
- committed-source lineage detection through causal event ID and source revision;
- valid busy-cell arrivals deferred before acceptance;
- bounded persistent per-recipient mailboxes;
- deterministic deferred release order;
- logical-epoch TTL and retry policies;
- deferred event and causal-arrival deduplication across scheduler jobs;
- exact-once lifecycle delivery after a busy cell returns to DORMANT;
- explicit mailbox overflow, expiry, retry-exhaustion, and release-blocked receipts;
- deferred mailboxes and policy state surviving persistence/reload;
- snapshot-shape validation and non-canonical state backfill;
- canonical hash equality with memory disabled versus enabled, including scheduler-enabled replay.

GitHub Actions executed 40 tests on Node.js v22.23.2: 40 passed and 0 failed.

The initial four-way scheduler order is checked across all 24 permutations. Deferred mailbox release order is also checked against reversed initial input order.

A local three-mode scheduler/lifecycle microbenchmark receipt is stored in `evidence/scheduler-benchmark-latest.json`. Deferred-mailbox timing has not been benchmarked.

## Interpretation

The results support the separation between canonical physical truth and experiential/advisory/perception/scheduling layers for this small prototype.

They show that, in the tested SOUND flow, a recipient cell can wake, run bounded specialist work, retain an observed memory, relay the signal, and sleep without changing canonical physical truth.

They also show that a valid arrival aimed at a simulated busy cell can wait in bounded persistent non-canonical state and later execute exactly once, without being prematurely marked seen and without creating false perception or memory while waiting.

They do not show genuine concurrent execution, fairness among unrelated scheduler jobs, realistic temporal semantics, or that all future signal types will preserve the authority boundary automatically.

## Deferred-delivery boundary

Deferred TTL is measured in deterministic scheduler-drain epochs, not seconds and not canonical world revisions.

A deferred arrival remains unaccepted until release. It therefore creates no guard-acceptance, lifecycle, perception, specialist, or memory effect while waiting.

Invalid arrivals are rejected before deferral, even when the target cell is busy.

Mailbox capacity overflow, expiry, and retry exhaustion are visible terminal policy outcomes. Overflowed work is not currently archived into a lossless external lineage queue.

A releasable entry remains deferred when active queue capacity is unavailable.

## Benchmark boundary

The existing v0.02 benchmark compares:

- envelope-only scheduling;
- recipient lifecycle with memory disabled;
- recipient lifecycle with memory enabled.

The measurements come from one local Node.js environment and show substantial run-to-run noise. Ratios below or near 1 must not be interpreted as lifecycle work being free or faster.

The benchmark establishes deterministic counts and a local timing sample only. It says nothing about deferred mailbox performance.

## Next proof work

- interruption-safe memory compaction;
- crash-safe atomic persistence and recovery;
- explicit cross-revision policy for paused and deferred jobs;
- fairness and ownership rules across unrelated schedulers targeting one cell;
- stronger long mixed-event/property tests;
- larger sleeping-world activation, mailbox, and storage measurements;
- physical/domain propagation rules such as attenuation and material response;
- an external lineage strategy for queue or mailbox overflow where lossless continuation is required.

## Not proven

Do not claim that EchoWorld:

- is cheaper than conventional engines;
- scales to massive persistent worlds;
- provides production multiplayer determinism;
- models realistic sound or fire propagation;
- handles genuine simultaneous cell execution;
- guarantees scheduler fairness;
- provides wall-clock delivery deadlines;
- creates compelling emergent stories;
- safely resolves every conflicting physical proposal;
- contains independent parallel workers;
- provides crash-safe durable storage;
- contains AI;
- makes AI safe by itself.

Specialists remain proposal-only. Perception and deferred delivery remain non-canonical. AI is not integrated in v0.01.
