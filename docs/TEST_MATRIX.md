# EchoWorld v0.01 Test Matrix

## Implemented checks

### Canonical truth

- memory-disabled and memory-enabled starter replay produce the same canonical hash
- scheduler-enabled replay retains the same memory-off vs memory-on canonical hash
- rejected movement creates no memory and no truth revision
- negative damage is rejected without truth or memory mutation
- specialist finish-order variation does not change canonical hash
- contradictory specialist proposal order does not change its conflict receipt
- scheduler execution records identical before/after canonical hashes

### Memory and persistence

- repeated relevant traversal stays inside declared memory budgets
- JSON persistence/reload preserves canonical hash
- malformed snapshot shape is rejected
- missing non-canonical handoff/scheduler fields are backfilled on reload
- a budget-paused scheduler queue survives persistence and resumes to drain

### Specialists

- FIRE matching excludes unrelated trading/diplomacy specialists
- stale proposal is rejected
- contradictory proposals are preserved and rejected from canonical mutation

### Handoffs and scheduler

- duplicate handoff ID is rejected
- causal-path cycle is rejected
- hop-limit excess is rejected
- one causal signal cannot be accepted twice at one recipient
- sender does not directly mutate neighbor truth
- terminal hop emits no further handoffs
- every permutation of the initial four-way queue produces the same scheduler receipt and guard state
- processing-budget exhaustion is explicit
- queue-capacity overflow is explicit and cannot report a clean drain
- explicit processEvent scheduling drains emitted handoffs without neighbor truth mutation

## Required later checks

- wake the same recipient cell twice under competing causal arrivals
- interrupted memory compaction and recovery
- corrupted episodic memory quarantine/repair
- missing lineage reference repair
- long mixed-event property testing
- larger sleeping world with tiny active region
- queued recipient-cell specialist execution
- cross-revision handoff policy
- lossless external overflow queue or lineage continuation
- crash during scheduler state persistence
