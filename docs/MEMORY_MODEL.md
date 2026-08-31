# EchoWorld v0.01 Memory Model

EchoWorld memory is bounded experiential state, not canonical truth authority.

## Current budgets per cell

- working: 16 records
- episodic: 8 records
- compressed: 4 summaries
- lineage refs: 16

These are test constraints, not permanent design constants.

## Memory provenance classes

### CANONICAL

Written only after a successful canonical truth commit.

Current additive importance factors:

- +5 structural change
- +4 injury/destruction
- +3 rare event
- +2 actor relationship relevance
- +1 repeated relevance
- +1 explicit human bookmark

### OBSERVED

Written only after a handoff passes the deterministic guard and the recipient cell processes the signal.

The observed record retains:

- handoff event ID;
- causal event ID;
- source revision;
- sender and recipient cell IDs;
- causal depth;
- `sourceCommitKnown`.

Current deterministic perception importance:

- +3 SOUND signal
- +2 if the declared source event type is FIRE or DAMAGE_STRUCTURE
- +1 for causal depth 1

These weights are prototype test rules, not permanent psychology or story rules.

An unverified synthetic signal may be retained as `OBSERVED`, but it is marked `sourceCommitKnown: false` and cannot be promoted into canonical truth.

## Retention

For both current memory paths:

- importance below 3 is not retained in working memory;
- 3+ may enter working memory;
- 5+ may enter episodic memory;
- 8+ may create a lineage reference when an eligible lineage source exists.

Memory-disabled mode performs the receiving lifecycle but writes no memory.

## Compaction

When working memory exceeds its budget, overflow records are grouped by provenance class, event class, and actor into bounded compressed summaries.

Compaction emits a receipt.

## Ordering invariants

Canonical-event memory:

`canonical validation -> canonical commit -> truth receipt -> CANONICAL memory`

Handoff perception memory:

`handoff guard acceptance -> recipient wake/specialists -> OBSERVED perception memory -> relay -> sleep`

A rejected canonical event creates no memory.

A rejected, duplicate, future-revision, or otherwise invalid handoff creates no recipient lifecycle and no perception memory.
