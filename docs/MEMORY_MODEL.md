# EchoWorld v0.01 Memory Model

EchoWorld memory is bounded experiential state, not canonical truth authority.

## Current budgets per cell

- working: 16 records
- episodic: 8 records
- compressed: 4 summaries
- lineage refs: 16

These are test constraints, not permanent design constants.

## Deterministic importance

The first prototype uses additive deterministic factors:

- +5 structural change
- +4 injury/destruction
- +3 rare event
- +2 actor relationship relevance
- +1 repeated relevance
- +1 explicit human bookmark

Retention in the current harness:

- importance below 3 is not retained in working memory;
- 3+ may enter working memory;
- 5+ may enter episodic memory;
- 8+ may create a lineage reference.

## Compaction

When working memory exceeds its budget, overflow records are grouped by event class and actor into bounded compressed summaries. Compaction emits a receipt.

## Commit ordering

Memory is written only after a successful canonical commit. A rejected event must not create memory describing a transition that never became true.
