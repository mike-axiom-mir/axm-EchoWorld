# EchoWorld v0.01 Architecture

The v0.01 harness keeps canonical physical truth separate from experiential, advisory, and scheduling state.

## Canonical event lifecycle

For a committed canonical event:

`event -> validate -> wake affected cells -> bounded relevant specialist proposals -> deterministic proposal merge gate -> explicit canonical rule + commit -> truth receipt -> bounded memory update from committed event -> bounded handoff emission -> sleep`

The specialist proposal merge gate runs against the current base revision before the canonical rule commits. It cannot mutate physical truth.

## Authority boundary

Canonical truth contains world revision, actor positions, and cell physical truth state.

The canonical hash intentionally excludes:

- memory;
- wake state;
- specialist receipts and merge receipts;
- handoff envelopes and guard receipts;
- handoff scheduler jobs and scheduler receipts.

Memory may retain, compact, or forget experiential history. It cannot rewrite canonical physical truth.

Specialists produce proposal receipts only. Conflicting proposals are sorted into a deterministic conflict receipt and rejected from canonical mutation.

Handoffs and the scheduler move bounded causal envelopes. They do not directly rewrite recipient-cell physical truth.

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
- repeated arrival of the same causal signal at the same recipient.

The causal-arrival key is:

`causalEventId | handoffType | recipientCellId`

For the current SOUND-only propagation proof, one deterministic first arrival is retained and later equivalent arrivals are coalesced.

## Deterministic queued scheduler

The scheduler orders work by a stable key containing depth, causal ID, type, sender, recipient, and event ID.

It has two independent resource bounds:

- `maxProcessed`: maximum envelopes drained in one run;
- `maxQueueSize`: maximum queued envelopes retained by one job.

A clean completion reports `DRAINED`.

If processing remains or queue capacity drops work, the receipt reports `BUDGET_EXHAUSTED`. It never labels an incomplete wave as a clean drain.

Unfinished processing-budget work remains in a persisted scheduler job. The job can survive JSON persistence/reload and resume deterministically.

Queue-capacity overflow is fail-closed and explicit, but dropped work cannot be reconstructed from the receipt alone. Raising that bound or adding an external lineage queue remains future work.

Every scheduler receipt records canonical hashes before and after. A changed hash would report `AUTHORITY_BREACH`.

## Current scheduler boundary

The scheduler currently propagates and guards event envelopes.

It does **not yet** perform the complete recipient-cell lifecycle:

`arrival -> wake cell -> relevance match -> local specialists -> memory/perception update -> new domain handoffs -> sleep`

That is the next architectural layer and must preserve the same truth boundary.

## Persistence

v0.01 provides JSON serialization/reload, validates the snapshot shape, backfills missing non-canonical scheduler fields, and proves persisted unfinished scheduler jobs can resume.

This is not crash-safe atomic durable storage.
