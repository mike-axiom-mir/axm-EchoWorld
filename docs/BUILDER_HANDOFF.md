# EchoWorld v0.01 Builder Handoff

Current lane: `chatgpt/echoworld-lane-01`

## Preserve

- one chat = one lane;
- canonical truth remains deterministic;
- memory and specialists are not truth authority;
- commit truth before memory;
- failed transitions create no false memory;
- no AI in v0.01;
- keep source honesty between observed, proposal, and not-proven claims.

## Current executable slice

The lane contains a dependency-free Node.js harness with:

- deterministic 16x16 cells;
- actors A/B and a bridge structure;
- MOVE, DAMAGE_STRUCTURE, FIRE events;
- canonical SHA-256 truth hashing;
- bounded memory and compaction;
- specialist proposal receipts;
- bounded first-hop handoff receipts;
- persistence/reload roundtrip;
- A/B truth-equivalence tests.

## Next smallest gaps

Prefer strengthening proof before adding presentation:

1. duplicate handoff detection;
2. actual hop-limited propagation with cycle prevention;
3. stale specialist proposal rejection;
4. conflicting specialist proposal deterministic merge;
5. crash-safe persistence/compaction recovery test;
6. larger sleeping-world resource measurements.

Do not add AI, narrative generation, VR, or production claims before the deterministic proof surface is stronger.
