# EchoWorld v0.01 Architecture

The v0.01 harness keeps canonical physical truth separate from experiential, advisory, perception, activation, deferred-delivery, memory-compaction, persistence, and scheduling state.

## Canonical event lifecycle

For a committed canonical event:

`event -> validate -> wake affected cells -> bounded relevant specialist proposals -> deterministic proposal merge gate -> explicit canonical rule + commit -> truth receipt -> bounded canonical-event memory -> journaled compaction if needed -> bounded handoff emission -> sleep`

The specialist proposal merge gate runs against the current base revision before the canonical rule commits. It cannot mutate physical truth.

## Recipient handoff lifecycle

After a handoff passes the deterministic guard, the receiving cell performs:

`accepted arrival -> wake -> SOUND relevance match -> temporary specialist receipts -> deterministic proposal merge gate -> OBSERVED perception receipt -> bounded observed memory if enabled -> journaled compaction if needed -> bounded relay handoffs -> sleep`

Current recipient processing is limited to the tested `SOUND` handoff class.

The recipient lifecycle does not advance world revision or change cell physical truth.

## Busy-cell deferred delivery

A valid handoff aimed at a non-`DORMANT` recipient is not accepted immediately.

The scheduler performs:

`inspect validity -> detect busy recipient -> defer into bounded mailbox -> retry on later deterministic drain epoch -> release only when DORMANT -> accept -> recipient lifecycle`

Inspection and acceptance are separate operations. Deferral happens before acceptance, so a deferred event is not added to `seenEventIds` or `seenArrivalKeys`. It creates no perception, memory, specialist, or lifecycle receipt until actual release and acceptance.

Each scheduler job declares `maxMailboxSize`, `maxDeferredRetries`, and `deferredTtlEpochs`. The epoch is a logical scheduler-drain counter, not wall-clock time and not canonical world revision.

Mailbox overflow, expiry, retry exhaustion, cancellation, and queue-capacity-blocked release are explicit receipt-bearing outcomes.

## Interruption-safe memory compaction

Working-memory compaction uses a copy-on-write journal rather than destructive splice-first mutation.

Before either memory array changes, EchoWorld stores:

- deterministic compaction ID;
- cell ID and generation;
- complete before working/compressed arrays and hashes;
- complete proposed after working/compressed arrays and hashes;
- overflow count and source event IDs;
- status `PREPARED`.

Normal sequence:

`PREPARED -> WORKING_SWAPPED -> COMPRESSED_SWAPPED -> COMMIT_RECEIPT_WRITTEN -> journal cleared`

`reloadWorld()` scans pending journals in stable cell-ID order.

Recognized mixed before/after states roll forward to the complete after-image. A corrupt after-image rolls back to the valid complete before-image. A corrupt before-image retains the journal, marks repair required, and places the cell in `REPAIR`.

Compaction summary keys include provenance class, so CANONICAL and OBSERVED memory cannot silently merge.

## Integrity-wrapped atomic persistence

The durable store wraps the complete `persistWorld(world)` payload in:

- generation;
- immediate parent snapshot ID;
- world schema;
- canonical hash;
- payload SHA-256;
- deterministic snapshot ID.

Candidate roles are:

- primary;
- backup;
- temp;
- recovery-temp.

Validation requires the envelope, payload hash, snapshot ID, world reload, world schema, and canonical hash to agree.

Recovery chooses the highest valid generation.

Identical highest-generation copies use stable role priority:

`primary -> temp -> recovery-temp -> backup`

Different valid snapshots claiming the same highest generation produce `SNAPSHOT_GENERATION_CONFLICT`.

No valid candidate means `NO_VALID_SNAPSHOT`. Save does not overwrite that unresolved store.

### Save ordering

```text
recover existing valid store
-> write temp
-> fsync temp
-> preserve old primary as backup
-> fsync directory
-> rename temp to primary
-> fsync directory
-> verify installed primary
```

### Recovery promotion

```text
inspect all candidates
-> select highest non-conflicting valid generation
-> write + fsync recovery-temp
-> rename recovery-temp to primary
-> fsync directory
-> verify promoted primary
```

The implementation calls file fsync and directory fsync and uses same-directory rename on the tested Ubuntu filesystem.

Nine abrupt child-process exits are tested: six save stages and three recovery-promotion stages.

## Truth and authority boundary

Canonical truth contains world revision, actor positions, and cell physical truth state.

The canonical hash intentionally excludes:

- memory and memory-compaction journals;
- memory-compaction receipts and repair state;
- perception receipts;
- activation and wake state;
- specialist receipts and merge receipts;
- handoff envelopes and guard receipts;
- scheduler jobs and scheduler receipts;
- deferred mailboxes and deferred-delivery receipts;
- atomic snapshot role, generation bookkeeping, candidate files, and persistence receipts.

Canonical-event memory uses provenance class `CANONICAL`.

Accepted handoff memory uses provenance class `OBSERVED` and retains causal evidence.

A persistence envelope records the canonical hash and rejects a payload whose reloaded canonical hash differs. Persistence selects among complete world snapshots; it does not create new canonical rules.

## Handoff envelope and guard

Each handoff carries stable event and causal IDs, sender/recipient IDs, causal depth, hop limit, causal path, source revision, and bounded parameters.

The guard rejects missing IDs, duplicates, unknown cells, invalid hop budgets, excess depth, causal cycles, missing causal IDs, invalid/future source revisions, and repeated causal arrival at one recipient.

Invalid signals are rejected before busy-cell deferral.

## Deterministic queued scheduler

The scheduler orders work using a stable key containing depth, causal ID, type, sender, recipient, and event ID.

Its independent bounds cover processed work, active queue size, mailbox size, deferred retries, and deferred logical TTL.

Scheduler completion states include `DRAINED`, `WAITING_FOR_DEFERRED_DELIVERY`, `DEFERRED_DELIVERY_EXHAUSTED`, `BUDGET_EXHAUSTED`, and `AUTHORITY_BREACH`.

Unfinished active and deferred work lives inside the serialized world and therefore participates in complete atomic snapshots.

## Recovery composition

Atomic snapshot validation calls `reloadWorld(payload)`.

This means one load can compose two deterministic recovery layers:

1. select and validate the newest complete snapshot candidate;
2. recover any pending non-canonical memory-compaction journal inside that snapshot.

The suite verifies that a snapshot containing a pending compaction reloads to the repaired memory state while preserving canonical truth.

## Current evidence

GitHub Actions run `33377190670`, job `99441212943`:

- Node.js v22.23.2
- Ubuntu 24.04
- 67 tests
- 67 passed
- 0 failed
- duration `2025.432072 ms`

## Persistence boundary

The current result is process-exit-resilient on the tested Linux CI filesystem.

It is not a universal power-loss guarantee.

An abrupt exit after `AFTER_TEMP_WRITE` happened before temp-file fsync. Recovery succeeded because the temp file was present and valid after that process exit. Sudden loss of power or volatile hardware caches at that point is untested.

Also unproven:

- multi-writer coordination;
- every filesystem and operating system;
- network filesystem semantics;
- cross-device rename;
- storage-controller durability;
- complete parent-chain verification;
- one transaction spanning world mutation and persistence admission;
- automatic repair when all candidates are invalid.

See `docs/ATOMIC_PERSISTENCE.md` for the full protocol and exact claim boundary.
