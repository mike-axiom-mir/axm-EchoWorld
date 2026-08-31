# EchoWorld v0.01 Test Matrix

## Current result

GitHub Actions implementation run `33405590474`, job `99532258471`:

- 85 tests
- 85 passed
- 0 failed
- 0 cancelled
- 0 skipped
- 0 todo
- Node.js v22.23.2
- Ubuntu 24.04.4
- duration `2086.800059 ms`
- merge ref `bc2ac474b60bd91e3574e5e597c44d1287c5113b`

## Existing deterministic-world checks

### Canonical truth

- memory-disabled and memory-enabled replay produce the same canonical hash
- scheduler-enabled replay retains memory-off versus memory-on equivalence
- rejected movement creates no memory and no revision
- invalid damage creates no truth or memory mutation
- specialist finish order cannot change canonical truth
- conflicting proposals are order-independent and non-authoritative
- direct and scheduler-batch lifecycle hash witnesses remain unchanged
- deferred mailbox and compaction paths remain non-canonical

### Memory and provenance

- canonical and observed memory stay bounded
- observed memory retains causal provenance
- memory-disabled lifecycle writes no memory
- duplicate arrivals cannot create duplicate perception/memory
- compaction never merges CANONICAL and OBSERVED provenance
- corrupted after-image rolls back without fake memory
- corrupted before-image enters explicit REPAIR

### Handoffs and lifecycle

- duplicate, cycle, hop-limit, future-revision, and repeated-arrival guards
- all 24 initial four-way queue permutations produce the same scheduler result
- processing, queue, and mailbox budgets fail explicitly
- SOUND arrival wakes, processes, optionally remembers, relays, and sleeps
- deferred delivery releases exactly once
- TTL and retry exhaustion fail closed
- deferred state survives persistence/reload

### Atomic snapshot persistence

- generation chain and backup retention
- payload tamper rejection
- highest-valid-generation selection
- same-generation identity conflict refusal
- corrupt-primary fallback
- valid-temp promotion and invalid-temp rejection
- refusal to overwrite all-invalid store
- process-exit recovery at six save stages
- restartable recovery at three promotion stages
- pending compaction recovery after atomic load

## Writer lease and fencing checks

### Active ownership

1. **one active writer lease blocks a second cooperative writer**
2. **simultaneous cooperative claims elect exactly one active writer**
3. **release permits immediate acquisition with a strictly higher fencing token**
4. **heartbeat renewal extends ownership and later stale takeover fences the old writer**
5. **an invalid burned claim cannot become active and the next token remains monotonic**

### Checkpoint admission

6. **leased checkpoint embeds fencing evidence and advances the lease base**
7. **a stale checkpoint base is rejected even while the same lease remains current**
8. **a stale owner cannot checkpoint after a higher fencing token takes over**
9. **checkpoint barrier rejects an unquiesced receiving cell**
10. **checkpoint operational hash covers pending queues, mailboxes, and compaction journals**
11. **checkpoint tampering invalidates the deterministic snapshot identity**

### Transient fencing and base races

12. **new fencing token discards an older leased temp that never reached primary commit**
13. **lease expiry during save prevents primary installation and the next owner fences the temp**
14. **leased checkpoint refuses a durable base changed by a non-cooperating writer**

### Lease process-exit recovery

15. **stale-owner recovery succeeds after process exit at AFTER_CLAIM_FSYNC**
16. **stale-owner recovery succeeds after process exit at AFTER_ACTIVATION_FSYNC**
17. **stale-owner recovery succeeds after process exit at AFTER_BASE_RECORD_FSYNC**
18. **process exit after durable release permits immediate replacement**

## What the new tests prove

- exclusive claim filenames allocate monotonic fence tokens;
- corrupt claim records cannot activate;
- one current cooperative writer is elected;
- heartbeats extend active expiry;
- expired/stale owners lose leased checkpoint authority;
- release is scoped to its own token and permits higher-token replacement;
- checkpoint admissions bind writer, token, base, canonical state, and selected operational state;
- active cells are rejected from default checkpoint admission;
- a stale lease base cannot be silently reused;
- a tested raw durable-base change is detected;
- an old leased temp does not outrank a newer writer after takeover;
- process exit after durable claim/activation/base/release records remains recoverable.

## Compatibility checks

The original unleased atomic snapshot tests continue to pass.

Legacy `axm.echoworld.atomic-snapshot/v0.01` remains readable.

Current leased/unleased writes use `axm.echoworld.atomic-snapshot/v0.02`; checkpoint may be null for compatibility writes.

## Required later checks

### Lease clock and lifecycle

- heartbeat process exit
- clock rollback and monotonic-clock evidence
- VM/process suspension beyond expiry
- stale release after newer writer commits
- high heartbeat count and ledger growth
- safe lease-ledger archival/compaction

### Stronger writer exclusion

- platform-native lock or compare-and-swap primitive
- hostile writer bypass attempts
- raw filesystem edit after final pre-rename assertion
- many-process contention and fairness
- network filesystem semantics

### Checkpoint transaction

- mutation after admission but before serialization
- mutation during asynchronous save
- immutable snapshot handoff or mutation-session freeze
- full queue/mailbox/compaction state identity rather than selected projection only
- process exit at every leased write-authority boundary

### Lineage and recovery

- complete parent-chain traversal
- fencing-token transition audit across generations
- bounded historical retention
- external trusted recovery when all local candidates are invalid

### Platform and durability

- Windows and macOS matrix
- multiple Linux filesystems
- controlled power-loss tests
- storage-controller durability
- dedicated lease/checkpoint/fsync/recovery benchmarks

### World proof

- long mixed-event property testing
- larger sleeping-world resource measurements
- material-aware attenuation and propagation
- genuine concurrent cell execution and deterministic fairness
