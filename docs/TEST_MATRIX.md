# EchoWorld v0.01 Test Matrix

## Implemented checks

### Canonical truth

- memory-disabled and memory-enabled starter replay produce the same canonical hash
- scheduler-enabled replay retains the same memory-off vs memory-on canonical hash
- rejected movement creates no memory and no truth revision
- negative damage is rejected without truth or memory mutation
- specialist finish-order variation does not change canonical hash
- contradictory specialist proposal order does not change its conflict receipt
- direct recipient lifecycle records identical before/after canonical hashes
- scheduler batches annotate recipient lifecycle receipts with an unchanged canonical hash witness

### Memory and provenance

- repeated canonical traversal stays inside declared memory budgets
- 40 different observed signals can wake one cell while memory remains bounded
- observed memory records causal event ID, source revision, causal depth, and OBSERVED provenance
- committed-source handoffs are marked `sourceCommitKnown: true`
- synthetic unverified signals remain OBSERVED and do not become canonical
- memory-disabled recipient processing writes no memory
- repeated/seen handoffs cannot create a second lifecycle or memory write
- observed memory compaction emits receipts

### Persistence

- JSON persistence/reload preserves canonical hash
- malformed snapshot shape is rejected
- missing non-canonical cell/handoff/scheduler fields are backfilled on reload
- a budget-paused scheduler queue survives persistence and resumes to drain
- perception and lifecycle receipts survive persistence without entering canonical truth

### Specialists

- FIRE matching excludes unrelated trading/diplomacy specialists
- SOUND arrivals select sound, witness-perception, and memory-importance specialists
- stale proposal is rejected
- contradictory proposals are preserved and rejected from canonical mutation
- arrival specialist finish order cannot change lifecycle meaning or canonical truth

### Handoffs and recipient lifecycle

- duplicate handoff ID is rejected
- causal-path cycle is rejected
- hop-limit excess is rejected
- future source revision is rejected before recipient activation
- one causal signal cannot be accepted twice at one recipient
- sender does not directly mutate neighbor truth
- terminal hop emits no further handoffs
- every permutation of the initial four-way queue produces the same scheduler receipt and guard state
- processing-budget exhaustion is explicit
- queue-capacity overflow is explicit and cannot report a clean drain
- accepted SOUND arrival wakes the recipient
- recipient returns to DORMANT after processing
- accepted arrival creates a perception receipt
- optional observed memory is written only when memory is enabled
- bounded relay handoffs are emitted after recipient processing
- explicit processEvent scheduling drains emitted handoffs without neighbor truth mutation

## Required later checks

- genuinely competing/concurrent arrivals while a cell is already active
- bounded retry or deferred delivery for a busy cell
- interrupted memory compaction and recovery
- corrupted episodic memory quarantine/repair
- missing lineage reference repair
- long mixed-event property testing
- larger sleeping world with tiny active region
- cross-revision handoff/scheduler policy
- lossless external overflow queue or lineage continuation
- crash during scheduler state persistence
- material-aware attenuation and domain propagation rules
