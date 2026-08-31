# EchoWorld v0.01 Architecture

The v0.01 harness keeps canonical physical truth separate from experiential, advisory, perception, activation, deferred-delivery, memory-compaction, and scheduling state.

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

Inspection and acceptance are separate operations. Deferral happens before acceptance, so a deferred event is not added to `seenEventIds` or `seenArrivalKeys`. It creates no perception, memory, specialist, or lifecycle receipt until it is actually released and accepted.

Each scheduler job declares `maxMailboxSize`, `maxDeferredRetries`, and `deferredTtlEpochs`. The epoch is a logical scheduler-drain counter, not wall-clock time and not canonical world revision.

Mailbox overflow, expiry, retry exhaustion, cancellation, and queue-capacity-blocked release are explicit receipt-bearing outcomes.

## Interruption-safe memory compaction

Working-memory compaction uses a copy-on-write journal rather than destructive splice-first mutation.

### Prepare

Before either memory array changes, EchoWorld stores:

- deterministic compaction ID;
- cell ID and generation;
- complete before working/compressed arrays and hashes;
- complete proposed after working/compressed arrays and hashes;
- overflow count and source event IDs;
- status `PREPARED`.

### Apply

The normal sequence is:

`PREPARED -> WORKING_SWAPPED -> COMPRESSED_SWAPPED -> COMMIT_RECEIPT_WRITTEN -> journal cleared`

A final compaction receipt is written before the journal is cleared. The cell records `compactionGeneration` and `lastCompactionId` before clearing pending state.

### Recovery

`reloadWorld()` backfills compaction fields, initializes the compaction receipt ledger, and scans cells in stable cell-ID order.

If the journal hashes are valid and the current arrays match any recognized before/after combination, recovery rolls forward to both after-images.

If a final commit receipt already exists, recovery reuses it and records only that committed journal state was cleared. It does not create a second final commit receipt.

If the proposed after-image is corrupt but the before-image is valid, both complete before-images are restored and `RECOVERED_ROLLBACK_CORRUPT_AFTER` is recorded.

If the before-image is corrupt, recovery cannot establish a trustworthy source. The journal is retained, `compactionRepairRequired` becomes true, and the cell enters `REPAIR`. New compaction attempts fail closed.

### Authority boundary

Compaction changes only non-canonical memory arrays. Compaction journals, generations, receipts, and repair state are excluded from the canonical hash.

The test suite checks the canonical hash before and after normal compaction, all four injected interruption stages, rollback, and repair-lock recovery.

## Truth and provenance boundary

Canonical truth contains world revision, actor positions, and cell physical truth state.

The canonical hash intentionally excludes:

- memory and memory-compaction journals;
- memory-compaction receipts and repair state;
- perception receipts;
- activation and wake state;
- specialist receipts and merge receipts;
- handoff envelopes and guard receipts;
- handoff scheduler jobs and scheduler receipts;
- deferred mailboxes and deferred-delivery receipts.

Canonical-event memory uses provenance class `CANONICAL`.

Accepted handoff memory uses provenance class `OBSERVED` and retains handoff event ID, causal event ID, source revision, sender/recipient IDs, causal depth, and whether a matching truth-commit receipt exists.

Compaction summary keys include provenance class, so CANONICAL and OBSERVED memory cannot silently merge.

## Handoff envelope and guard

Each handoff carries stable event and causal IDs, sender/recipient cell IDs, causal depth, hop limit, causal path, source revision, and bounded parameters.

The guard rejects missing IDs, duplicates, unknown cells, invalid hop budgets, excess depth, causal cycles, missing causal IDs, invalid/future source revisions, and repeated causal arrival at one recipient.

The causal-arrival key is:

`causalEventId | handoffType | recipientCellId`

Invalid signals are rejected before busy-cell deferral.

## Deterministic queued scheduler

The scheduler orders work by a stable key containing depth, causal ID, type, sender, recipient, and event ID.

Its independent bounds cover processed work, active queue size, mailbox size, deferred retries, and deferred logical TTL.

Scheduler completion states include `DRAINED`, `WAITING_FOR_DEFERRED_DELIVERY`, `DEFERRED_DELIVERY_EXHAUSTED`, `BUDGET_EXHAUSTED`, and `AUTHORITY_BREACH`.

Unfinished active and deferred work remains in persisted scheduler state and can resume after JSON reload.

## Canonical mutation witnesses

A directly invoked recipient lifecycle computes its own before/after canonical hash.

Scheduler-driven lifecycles compute one canonical hash before and after the drained batch and annotate lifecycle receipts with that result.

Memory-compaction recovery is also tested against an unchanged canonical hash.

## Persistence

v0.01 provides JSON serialization/reload, validates snapshot shape, backfills missing non-canonical cell/scheduler/mailbox/compaction fields, recovers pending valid compactions, and preserves evidence receipts.

This is not crash-atomic durable storage. Atomic file replacement, fsync behavior, process-kill testing during snapshot write, queue/mailbox/compaction transaction unification, genuine concurrent execution, and scheduler fairness remain unproven.
