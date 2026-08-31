# EchoWorld v0.01 Test Matrix

## Implemented checks

### Canonical truth

- memory-disabled and memory-enabled starter replay produce the same canonical hash
- scheduler-enabled replay retains the same memory-off versus memory-on canonical hash
- rejected movement creates no memory and no truth revision
- negative damage is rejected without truth or memory mutation
- specialist finish-order variation does not change canonical hash
- contradictory specialist proposal order does not change its conflict receipt
- direct recipient lifecycle records identical before/after canonical hashes
- scheduler batches annotate lifecycle receipts with an unchanged canonical hash witness
- deferred mailbox operations remain inside the unchanged scheduler hash witness
- compaction and recovery paths leave canonical hash unchanged
- atomic snapshot envelopes reject a reloaded world whose canonical hash differs
- every recovered process-exit snapshot has the expected canonical hash

### Memory and provenance

- repeated canonical traversal stays inside declared memory budgets
- 40 different observed signals can wake one cell while memory remains bounded
- observed memory records causal event ID, source revision, causal depth, and OBSERVED provenance
- committed-source handoffs are marked `sourceCommitKnown: true`
- synthetic unverified signals remain OBSERVED and do not become canonical
- memory-disabled recipient processing writes no memory
- repeated/seen handoffs cannot create a second lifecycle or memory write
- deferred arrival creates no perception or memory before actual acceptance
- expiry and retry exhaustion create no false perception or memory
- compaction summary keys keep CANONICAL and OBSERVED records separate

### Interruption-safe memory compaction

- copy-on-write compaction preserves semantic record count in the tested plan
- working and compressed arrays stay inside declared budgets after commit
- one deterministic final commit receipt is written
- interruption after journal prepare recovers
- interruption after working-array swap recovers
- interruption after compressed-array swap recovers
- interruption after commit receipt clears the journal without duplicating the final receipt
- recovery is idempotent
- corrupt after-image restores the complete valid before-image without fake memory
- corrupt before-image retains the journal and enters `REPAIR`
- repeated reload does not duplicate the same corrupt-before failure receipt

### Handoffs, lifecycle, and deferred delivery

- duplicate, causal-cycle, hop-limit, future-revision, and repeated-arrival guards
- sender does not directly mutate neighbor truth
- terminal hop emits no further handoffs
- all 24 permutations of the initial four-way queue produce the same scheduler receipt and guard state
- processing, queue, and mailbox capacity failures are explicit
- accepted SOUND arrival wakes, perceives, optionally remembers, relays, and sleeps
- deferred delivery releases exactly once when recipient becomes DORMANT
- deferred event and causal-arrival deduplication works across scheduler jobs
- deterministic TTL expiry and retry exhaustion fail closed
- mailbox release order is independent of initial input order
- deferred queue and policy survive persistence and resume

### Atomic snapshot envelope

- generation 1 and generation 2 form a verified immediate parent chain
- previous primary is retained as backup
- installed primary reopens and passes every integrity check
- payload tampering is rejected before world reload
- invalid generation-looking temp content receives no authority
- same-generation identical candidates resolve to primary by stable priority
- same-generation different valid identities fail closed
- a store with existing files but no valid candidate is not overwritten
- atomic snapshot loading composes with pending memory-compaction recovery

### Deterministic recovery selection

- corrupt primary falls back to valid backup and promotes it
- valid higher-generation temp beats older valid primary and is promoted
- invalid temp is ignored and cleaned while valid primary remains authoritative
- promoted primary is reopened and checked against selected snapshot ID
- transient files are cleaned after successful recovery
- recovery selects no candidate when all candidates are invalid

### Abrupt save-process exits

The child worker exits with code 86 at:

- `AFTER_TEMP_WRITE`
- `AFTER_TEMP_FSYNC`
- `AFTER_BACKUP_RENAME`
- `AFTER_BACKUP_DIRECTORY_FSYNC`
- `AFTER_PRIMARY_RENAME`
- `AFTER_PRIMARY_DIRECTORY_FSYNC`

After each exit:

- a later process recovers generation 2;
- actor A is at x=2;
- world revision is 1;
- canonical hash matches the recovered envelope;
- the recovered primary validates as generation 2.

### Abrupt recovery-process exits

The recovery worker exits with code 86 at:

- `AFTER_RECOVERY_TEMP_FSYNC`
- `AFTER_RECOVERY_PRIMARY_RENAME`
- `AFTER_RECOVERY_DIRECTORY_FSYNC`

After each exit, another recovery completes and installs the expected generation 2 primary.

### Persistence mechanics

- temp file is fsynced before normal installation
- backup temp is fsynced before backup rename
- directory is fsynced after backup rename
- primary is installed with same-directory rename
- directory is fsynced after primary rename
- installed primary is verified
- recovery temp is fsynced before recovery promotion
- promoted primary is verified
- directory fsync unsupported behavior fails closed by default

## Current result

GitHub Actions run `33377190670`, job `99441212943`:

- 67 tests
- 67 passed
- 0 failed
- 0 cancelled
- 0 skipped
- Node.js v22.23.2
- Ubuntu 24.04
- duration `2025.432072 ms`
- merge ref `e1a61f0b3b8ccf965fe3015c0ec07d20d8848366`

## Required later checks

- simultaneous writer collision and fencing
- stale lock recovery
- process exit during writer-lock acquisition and release
- complete parent-chain verification
- transaction spanning canonical mutation, queue, mailbox, and compaction journal
- physical power-loss tests
- filesystem and operating-system matrix
- network filesystem behavior
- cross-device path rejection
- all-candidates-corrupt external recovery
- corrupted episodic memory quarantine and repair
- missing lineage reference repair
- long mixed-event property testing
- larger sleeping world with tiny active region
- material-aware attenuation and domain propagation
- atomic persistence throughput, latency, and recovery benchmarks
