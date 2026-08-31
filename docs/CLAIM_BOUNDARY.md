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
- snapshot-shape validation and non-canonical state backfill;
- canonical hash equality with memory disabled versus enabled, including scheduler-enabled replay.

The local checkpoint is covered by 31 passing Node tests.

The initial four-way scheduler order is checked across all 24 permutations.

A local three-mode scheduler/lifecycle microbenchmark receipt is stored in `evidence/scheduler-benchmark-latest.json`.

## Interpretation

The results support the separation between canonical physical truth and experiential/advisory/perception/scheduling layers for this small prototype.

They show that, in the tested SOUND flow, a recipient cell can wake, run bounded specialist work, retain an observed memory, relay the signal, and sleep without changing canonical physical truth.

They do not show that all future signal types or domain rules will preserve that boundary automatically.

## Benchmark boundary

The v0.02 benchmark compares:

- envelope-only scheduling;
- recipient lifecycle with memory disabled;
- recipient lifecycle with memory enabled.

The measurements come from one local Node.js environment and show substantial run-to-run noise. Ratios below or near 1 must not be interpreted as lifecycle work being free or faster.

The benchmark establishes deterministic counts and a local timing sample only.

## Next proof work

- bounded busy-cell retry or deferred arrival handling;
- interruption-safe memory compaction;
- crash-safe atomic persistence and recovery;
- cross-revision paused-job policy;
- larger sleeping-world activation and storage measurements;
- stronger long mixed-event/property tests;
- physical/domain propagation rules such as attenuation and material response;
- an external lineage strategy for queue-capacity overflow where lossless continuation is required.

## Not proven

Do not claim that EchoWorld:

- is cheaper than conventional engines;
- scales to massive persistent worlds;
- provides production multiplayer determinism;
- models realistic sound or fire propagation;
- handles genuine concurrent cell activation;
- creates compelling emergent stories;
- safely resolves every conflicting physical proposal;
- contains independent parallel workers;
- contains AI;
- makes AI safe by itself.

Specialists remain proposal-only. Perception remains non-canonical. AI is not integrated in v0.01.
