# EchoWorld v0.01 Claim Boundary

## Observed in this lane

The current prototype contains a small deterministic 16x16 world harness with bounded memory, deterministic event processing, specialist proposal receipts, bounded first-hop handoff receipts, persistence roundtrip support, and canonical hashing.

The current test suite checks:

- memory-enabled and memory-disabled execution reach the same canonical hash for the starter scenario;
- failed canonical transitions create no memory;
- specialist receipt finish order does not change canonical truth in the starter scenario;
- persistence/reload preserves canonical truth;
- declared memory budgets remain bounded across repeated relevant traversal;
- event specialist matching excludes unrelated contracts in the tested FIRE case;
- handoff receipt generation does not directly mutate neighbor canonical truth.

## Proposal / next proof work

Still to build or strengthen:

- duplicate handoff suppression;
- actual multi-hop propagation with hop/cycle bounds;
- stale specialist proposal rejection;
- conflicting proposal merge rules;
- crash/interruption recovery for persistence and compaction;
- larger sleeping-world activation measurements;
- stronger worker-order shuffle/property tests;
- durable evidence export and benchmark receipts.

## Not proven

Do not claim that EchoWorld is cheaper than conventional engines, scales to massive persistent worlds, creates compelling emergent stories, provides production multiplayer determinism, or makes AI safe by itself.

AI is not integrated in v0.01 and must not become canonical physical truth authority in later experiments.
