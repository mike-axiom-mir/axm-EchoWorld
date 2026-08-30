# EchoWorld v0.01 Test Matrix

## Implemented checks

- A/B canonical hash equality with memory disabled vs enabled
- rejected move creates no memory and no truth revision
- specialist receipt finish-order variation does not change canonical hash
- JSON persistence/reload preserves canonical hash
- repeated relevant traversal stays within declared memory budgets
- FIRE relevance matching excludes unrelated trading/diplomacy specialists
- first-hop handoff receipts stay bounded and do not directly mutate neighbor truth

## Required later checks

- duplicate handoff
- handoff cycle
- hop-limit exhaustion
- stale specialist proposal
- conflicting specialist proposals
- specialist recursion budget
- wake same cell twice
- interrupted compaction
- corrupted episodic memory
- missing lineage ref
- larger repeated-event stress
- large sleeping world with tiny active region
