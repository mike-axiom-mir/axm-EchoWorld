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
- scheduler batches annotate lifecycle receipts with an unchanged canonical hash witness
- deferred mailbox operations remain inside the unchanged scheduler hash witness
- normal, interrupted, recovered, rolled-back, and repair-locked compaction paths leave canonical hash unchanged

### Memory and provenance

- repeated canonical traversal stays inside declared memory budgets
- 40 different observed signals can wake one cell while memory remains bounded
- observed memory records causal event ID, source revision, causal depth, and OBSERVED provenance
- committed-source handoffs are marked `sourceCommitKnown: true`
- synthetic unverified signals remain OBSERVED and do not become canonical
- memory-disabled recipient processing writes no memory
- repeated/seen handoffs cannot create a second lifecycle or memory write
- a deferred arrival creates no perception or memory before actual acceptance
- expiry and retry exhaustion create no false perception or memory
- compaction summary keys keep CANONICAL and OBSERVED records separate

### Interruption-safe memory compaction

- copy-on-write compaction preserves semantic record count in the tested plan
- working and compressed arrays stay inside declared budgets after commit
- compaction writes one deterministic final commit receipt
- interruption after journal prepare recovers to the uninterrupted result
- interruption after working-array swap recovers to the uninterrupted result
- interruption after compressed-array swap recovers to the uninterrupted result
- interruption after commit receipt clears the journal without duplicating the final receipt
- recovery is idempotent after repair
- corrupt after-image restores the complete valid before-image and introduces no fake record
- corrupt before-image retains the journal, marks `compactionRepairRequired`, and enters `REPAIR`
- repeated reload of a corrupt-before journal does not duplicate the same failure receipt

### Persistence

- JSON persistence/reload preserves canonical hash
- malformed snapshot shape is rejected
- missing non-canonical cell/handoff/scheduler/mailbox/compaction fields are backfilled
- a budget-paused scheduler queue survives persistence and resumes to drain
- perception and lifecycle receipts survive persistence without entering canonical truth
- deferred mailboxes and retry/TTL policy survive persistence and resume
- pending valid compaction journals are recovered automatically during reload
- compaction receipts and generation state survive persistence

### Specialists

- FIRE matching excludes unrelated trading/diplomacy specialists
- SOUND arrivals select sound, witness-perception, and memory-importance specialists
- stale proposal is rejected
- contradictory proposals are preserved and rejected from canonical mutation
- arrival specialist finish order cannot change lifecycle meaning or canonical truth
- deferred arrival runs no specialist until released and accepted

### Handoffs, lifecycle, and deferred delivery

- duplicate, causal-cycle, hop-limit, future-revision, and repeated-arrival guards
- sender does not directly mutate neighbor truth
- terminal hop emits no further handoffs
- every permutation of the initial four-way queue produces the same scheduler receipt and guard state
- processing, queue, and mailbox capacity failures are explicit
- accepted SOUND arrival wakes, perceives, optionally remembers, relays, and sleeps
- deferred delivery releases exactly once when recipient becomes DORMANT
- deferred event/causal-arrival deduplication works across scheduler jobs
- deterministic TTL expiry and retry exhaustion fail closed
- mailbox release order is independent of initial input order

## Current result

GitHub Actions run `33374326936`, job `99432286023`:

- 49 tests
- 49 passed
- 0 failed
- Node.js v22.23.2
- duration `761.555682 ms`

## Required later checks

- actual process-kill during snapshot write
- atomic temporary-file replacement and integrity-envelope recovery
- corruption of both compaction images
- trusted-lineage repair for corrupt-before state
- transaction spanning active queue, mailbox, and compaction journal
- genuine competing/concurrent execution rather than simulated busy state
- fairness across unrelated scheduler jobs targeting one recipient
- corrupted episodic memory quarantine/repair
- missing lineage reference repair
- long mixed-event property testing
- larger sleeping world with tiny active region
- cross-revision handoff/scheduler/mailbox policy
- lossless external overflow queue or lineage continuation
- material-aware attenuation and domain propagation rules
- mailbox, compaction, and recovery benchmarks
