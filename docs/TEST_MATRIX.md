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
- deferred mailbox operations remain inside the scheduler's unchanged canonical hash witness

### Memory and provenance

- repeated canonical traversal stays inside declared memory budgets
- 40 different observed signals can wake one cell while memory remains bounded
- observed memory records causal event ID, source revision, causal depth, and OBSERVED provenance
- committed-source handoffs are marked `sourceCommitKnown: true`
- synthetic unverified signals remain OBSERVED and do not become canonical
- memory-disabled recipient processing writes no memory
- repeated/seen handoffs cannot create a second lifecycle or memory write
- observed memory compaction emits receipts
- a deferred arrival creates no perception or memory before actual acceptance
- expiry and retry exhaustion create no false perception or memory

### Persistence

- JSON persistence/reload preserves canonical hash
- malformed snapshot shape is rejected
- missing non-canonical cell/handoff/scheduler/mailbox fields are backfilled on reload
- a budget-paused scheduler queue survives persistence and resumes to drain
- perception and lifecycle receipts survive persistence without entering canonical truth
- deferred mailboxes and retry/TTL policy survive persistence and resume
- deferred-delivery receipts survive persistence as non-canonical evidence

### Specialists

- FIRE matching excludes unrelated trading/diplomacy specialists
- SOUND arrivals select sound, witness-perception, and memory-importance specialists
- stale proposal is rejected
- contradictory proposals are preserved and rejected from canonical mutation
- arrival specialist finish order cannot change lifecycle meaning or canonical truth
- a deferred arrival runs no specialist until it is released and accepted

### Handoffs and recipient lifecycle

- duplicate handoff ID is rejected
- causal-path cycle is rejected
- hop-limit excess is rejected
- future source revision is rejected before recipient activation
- future source revision is rejected rather than deferred when the recipient is busy
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

### Busy-cell deferred delivery

- a valid busy-cell arrival is deferred before acceptance
- deferred arrival is not added to the seen ledger while waiting
- deferred arrival creates no guard-acceptance, lifecycle, perception, specialist, or memory effect while waiting
- a deferred arrival releases exactly once after its recipient returns to DORMANT
- resuming a drained scheduler cannot deliver the same deferred arrival twice
- a second scheduler cannot enqueue an event already present in any deferred mailbox
- deterministic TTL expiry removes waiting work with an explicit receipt
- deterministic retry exhaustion removes waiting work with an explicit receipt
- per-recipient mailbox overflow reports `BUDGET_EXHAUSTED` and `MAILBOX_BUDGET_EXCEEDED`
- mailbox release order is identical for forward and reversed initial input order
- releasable mail remains deferred if the active queue has no capacity

## Required later checks

- genuine competing/concurrent execution rather than simulated busy state
- fairness across unrelated scheduler jobs targeting one recipient
- atomic handoff between active queue and deferred mailbox under crash
- interrupted memory compaction and recovery
- corrupted episodic memory quarantine/repair
- missing lineage reference repair
- long mixed-event property testing
- larger sleeping world with tiny active region
- cross-revision handoff/scheduler/mailbox policy
- lossless external overflow queue or lineage continuation
- crash during scheduler or mailbox state persistence
- material-aware attenuation and domain propagation rules
- mailbox load and retention benchmarks
