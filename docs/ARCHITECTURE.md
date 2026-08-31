# EchoWorld v0.01 Architecture

The v0.01 harness keeps canonical physical truth separate from experiential, advisory, perception, activation, deferred-delivery, and scheduling state.

## Canonical event lifecycle

For a committed canonical event:

`event -> validate -> wake affected cells -> bounded relevant specialist proposals -> deterministic proposal merge gate -> explicit canonical rule + commit -> truth receipt -> bounded canonical-event memory -> bounded handoff emission -> sleep`

The specialist proposal merge gate runs against the current base revision before the canonical rule commits. It cannot mutate physical truth.

## Recipient handoff lifecycle

After a handoff passes the deterministic guard, the receiving cell performs:

`accepted arrival -> wake -> SOUND relevance match -> temporary specialist receipts -> deterministic proposal merge gate -> OBSERVED perception receipt -> bounded observed memory if enabled -> bounded relay handoffs -> sleep`

Current recipient processing is limited to the tested `SOUND` handoff class.

The recipient lifecycle does not advance world revision or change cell physical truth.

## Busy-cell deferred delivery

A valid handoff aimed at a non-`DORMANT` recipient is not accepted immediately.

The scheduler performs:

`inspect validity -> detect busy recipient -> defer into bounded mailbox -> retry on later deterministic drain epoch -> release only when DORMANT -> accept -> recipient lifecycle`

Inspection and acceptance are separate operations. Deferral happens before acceptance, so a deferred event is not added to `seenEventIds` or `seenArrivalKeys`. It creates no perception, memory, specialist, or lifecycle receipt until it is actually released and accepted.

Each scheduler job declares:

- `maxMailboxSize`: maximum retained deferred entries per recipient mailbox;
- `maxDeferredRetries`: maximum busy rechecks before failure;
- `deferredTtlEpochs`: maximum deterministic scheduler-drain epochs before expiry.

The deferred epoch is a logical counter advanced by scheduler drains. It is not wall-clock time and does not advance canonical world revision.

Deferred mailboxes are ordered using the same stable handoff order as the active queue. Deferred event IDs and causal-arrival keys participate in prequeue deduplication across scheduler jobs.

A mailbox sweep may produce:

- `RELEASED`
- `RETRY_DEFERRED`
- `EXPIRED`
- `RETRY_EXHAUSTED`
- `CANCELLED_ALREADY_SEEN`
- `RELEASE_BLOCKED_QUEUE_CAPACITY`

Initial deferral may additionally produce:

- `DEFERRED`
- `DUPLICATE_DEFERRED_EVENT`
- `DUPLICATE_DEFERRED_CAUSAL_ARRIVAL`
- `MAILBOX_BUDGET_EXCEEDED`

If active-queue capacity is unavailable, a releasable entry remains in the mailbox rather than being silently dropped.

Mailbox overflow, expiry, and retry exhaustion are explicit. Overflow is not losslessly recoverable from the receipt alone.

## Truth and provenance boundary

Canonical truth contains world revision, actor positions, and cell physical truth state.

The canonical hash intentionally excludes:

- memory;
- perception receipts;
- activation and wake state;
- specialist receipts and merge receipts;
- handoff envelopes and guard receipts;
- handoff scheduler jobs and scheduler receipts;
- deferred mailboxes and deferred-delivery receipts.

Canonical-event memory uses provenance class `CANONICAL`.

Accepted handoff memory uses provenance class `OBSERVED` and retains:

- handoff event ID;
- causal event ID;
- source revision;
- sender and recipient cell IDs;
- causal depth;
- whether a matching truth-commit receipt exists.

`sourceCommitKnown: false` means the signal's cause was not verified against the local truth receipt ledger. It does not become canonical merely because a cell observed it.

## Handoff envelope and guard

Each handoff carries:

- stable event ID;
- causal event ID;
- sender and recipient cell IDs;
- causal depth and hop limit;
- causal path;
- source revision;
- bounded parameters.

The guard rejects:

- missing IDs;
- duplicate handoff IDs;
- unknown cells;
- invalid hop budgets;
- events beyond their hop limit;
- causal cycles;
- missing causal event IDs;
- invalid or future source revisions;
- repeated arrival of the same causal signal at the same recipient.

The causal-arrival key is:

`causalEventId | handoffType | recipientCellId`

For the current SOUND proof, one deterministic first arrival is retained and later equivalent arrivals are coalesced.

Invalid signals are rejected before busy-cell deferral. A busy cell is not a reason to preserve an otherwise invalid envelope.

## Deterministic queued scheduler

The scheduler orders work by a stable key containing depth, causal ID, type, sender, recipient, and event ID.

It has independent resource bounds for active and deferred work:

- `maxProcessed`: maximum envelopes drained in one run;
- `maxQueueSize`: maximum active queued envelopes retained by one job;
- `maxMailboxSize`: maximum deferred envelopes retained for one recipient;
- `maxDeferredRetries`: maximum busy rechecks;
- `deferredTtlEpochs`: maximum logical retention age.

Scheduler completion states include:

- `DRAINED`: no active or deferred work remains and no terminal policy failure occurred;
- `WAITING_FOR_DEFERRED_DELIVERY`: valid deferred work remains;
- `DEFERRED_DELIVERY_EXHAUSTED`: expiry or retry exhaustion occurred;
- `BUDGET_EXHAUSTED`: active queue or mailbox capacity was exceeded, or active processing remains;
- `AUTHORITY_BREACH`: canonical hash changed across the scheduler boundary.

Unfinished active and deferred work remains in persisted scheduler state and can resume after JSON reload.

## Canonical mutation witnesses

A directly invoked recipient lifecycle computes its own before/after canonical hash.

Scheduler-driven lifecycles defer the expensive full-world hash to the scheduler boundary. The scheduler computes one canonical hash before the job and one after the drained batch, then annotates each lifecycle receipt with that result.

Deferred mailbox operations are covered by the same scheduler-boundary hash witness.

A changed scheduler-boundary hash reports `AUTHORITY_BREACH`.

## Persistence

v0.01 provides JSON serialization/reload, validates the snapshot shape, backfills missing non-canonical cell, scheduler, and mailbox fields, and proves that perception receipts, lifecycle receipts, deferred-delivery receipts, paused queues, and deferred mailboxes survive reload.

This is not crash-safe atomic durable storage. Genuine concurrent execution, fairness across unrelated scheduler jobs, and atomic mailbox/queue persistence remain unproven.
