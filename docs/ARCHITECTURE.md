# EchoWorld v0.01 Architecture

The v0.01 harness keeps canonical physical truth separate from experiential, advisory, perception, activation, and scheduling state.

## Canonical event lifecycle

For a committed canonical event:

`event -> validate -> wake affected cells -> bounded relevant specialist proposals -> deterministic proposal merge gate -> explicit canonical rule + commit -> truth receipt -> bounded canonical-event memory -> bounded handoff emission -> sleep`

The specialist proposal merge gate runs against the current base revision before the canonical rule commits. It cannot mutate physical truth.

## Recipient handoff lifecycle

After a handoff passes the deterministic guard, the receiving cell performs:

`accepted arrival -> wake -> SOUND relevance match -> temporary specialist receipts -> deterministic proposal merge gate -> OBSERVED perception receipt -> bounded observed memory if enabled -> bounded relay handoffs -> sleep`

Current recipient processing is limited to the tested `SOUND` handoff class.

The recipient lifecycle does not advance world revision or change cell physical truth.

## Truth and provenance boundary

Canonical truth contains world revision, actor positions, and cell physical truth state.

The canonical hash intentionally excludes:

- memory;
- perception receipts;
- activation and wake state;
- specialist receipts and merge receipts;
- handoff envelopes and guard receipts;
- handoff scheduler jobs and scheduler receipts.

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

## Deterministic queued scheduler

The scheduler orders work by a stable key containing depth, causal ID, type, sender, recipient, and event ID.

It has two independent resource bounds:

- `maxProcessed`: maximum envelopes drained in one run;
- `maxQueueSize`: maximum queued envelopes retained by one job.

A clean completion reports `DRAINED`.

If processing remains or queue capacity drops work, the receipt reports `BUDGET_EXHAUSTED`. It never labels an incomplete wave as a clean drain.

Unfinished processing-budget work remains in a persisted scheduler job and can resume after JSON reload.

Queue-capacity overflow is fail-closed and explicit, but dropped work cannot be reconstructed from the receipt alone.

## Canonical mutation witnesses

A directly invoked recipient lifecycle computes its own before/after canonical hash.

Scheduler-driven lifecycles defer the expensive full-world hash to the scheduler boundary. The scheduler computes one canonical hash before the job and one after the drained batch, then annotates each lifecycle receipt with that result.

This avoids recalculating the entire canonical world for every cell while preserving an explicit authority witness around the complete batch.

A changed scheduler-boundary hash reports `AUTHORITY_BREACH`.

## Persistence

v0.01 provides JSON serialization/reload, validates the snapshot shape, backfills missing non-canonical cell and scheduler fields, and proves that perception receipts, lifecycle receipts, and paused scheduler jobs survive reload.

This is not crash-safe atomic durable storage.
