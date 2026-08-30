# EchoWorld v0.01 Claim Boundary

## Observed in this lane

The current lane demonstrates a small deterministic persistent-cell harness with:

- stable cell identity and canonical revision state;
- bounded memory written only after successful truth commit;
- deterministic specialist matching and proposal receipts;
- a deterministic proposal merge gate that rejects stale proposals;
- deterministic preservation/rejection of contradictory specialist proposals without canonical mutation;
- bounded handoff generation, duplicate rejection, causal-path cycle rejection, and hop-limit enforcement;
- an explicit bounded propagation step that does not directly mutate neighbor canonical truth;
- persistence/reload of the harness state;
- canonical hash equality for the starter event stream with memory disabled versus enabled.

The hardened checkpoint is covered by 13 passing Node tests and a successful GitHub Actions run recorded in `evidence/test-receipt-latest.json`.

## Interpretation

These results support the architectural separation between canonical physical truth and experiential/advisory layers for this small prototype.

They do not establish that the design will scale economically or outperform conventional game architectures.

## Proposal / next proof work

Still to build or strengthen:

- full queued world propagation scheduling over the guarded handoff primitives;
- crash/interruption recovery for persistence and compaction;
- larger sleeping-world activation measurements;
- stronger worker-order shuffle/property tests;
- domain-specific deterministic rules for cases where conflicting proposals must eventually feed a canonical rule;
- durable benchmark receipts.

## Not proven

Do not claim that EchoWorld is cheaper than conventional engines, scales to massive persistent worlds, creates compelling emergent stories, provides production multiplayer determinism, or makes AI safe by itself.

Specialists remain proposal-only. A conflict receipt is not permission to mutate canonical truth.

AI is not integrated in v0.01 and must not become canonical physical truth authority in later experiments.
