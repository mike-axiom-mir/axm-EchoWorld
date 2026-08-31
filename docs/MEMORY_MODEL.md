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

## Copy-on-write compaction

When working memory exceeds its budget, EchoWorld no longer mutates the working and compressed arrays as an unguarded two-step operation.

It first creates a persisted journal:

```text
PREPARED
  before.working + hash
  before.compressed + hash
  after.working + hash
  after.compressed + hash
  compactionId + generation + source event IDs
```

Only after the journal exists does it swap the working array, swap the compressed array, write one final compaction receipt, advance the compaction generation, and clear the journal.

The deterministic compaction identity is derived from:

- cell ID;
- compaction generation;
- before-working hash;
- before-compressed hash;
- after-working hash;
- after-compressed hash.

Compressed summaries are grouped by:

`provenanceClass | eventClass | actorId`

CANONICAL and OBSERVED records therefore cannot silently collapse into one summary.

## Tested interruption points

The harness can inject an interruption at:

- `AFTER_PREPARE`
- `AFTER_WORKING_SWAP`
- `AFTER_COMPRESSED_SWAP`
- `AFTER_COMMIT_RECEIPT`

These are test seams. Normal runtime does not request an interruption.

## Reload recovery

`reloadWorld()` backfills memory-compaction fields and then scans cells in stable cell-ID order.

For a valid pending journal:

- a current array may match either its before-image or after-image;
- recognized mixed states, such as working swapped but compressed not swapped, roll forward to the complete after-image;
- recovery writes at most one final `COMMITTED` or `RECOVERED_COMMIT` receipt for the compaction ID;
- a second recovery scan is idempotent.

If the after-image or its hash is corrupt but the before-image is valid:

- EchoWorld restores both complete before-images;
- clears the pending journal;
- records `RECOVERED_ROLLBACK_CORRUPT_AFTER`;
- invents no replacement memory.

If the before-image cannot be trusted:

- the journal is retained;
- `compactionRepairRequired` becomes true;
- the cell enters `REPAIR`;
- new compaction attempts fail with `MEMORY_COMPACTION_REPAIR_REQUIRED`;
- repeated reloads do not multiply the same failure receipt.

This is fail-closed. EchoWorld does not guess which corrupted memory was authentic.

## Compaction receipts

Compaction receipts use:

`axm.echoworld.memory-compaction-receipt/v0.02`

They include:

- compaction ID and generation;
- cell ID and world revision;
- operation status and stage;
- before/after counts;
- compacted source event IDs;
- before/after hashes for both arrays;
- interruption or recovery information when applicable.

## Ordering invariants

Canonical-event memory:

`canonical validation -> canonical commit -> truth receipt -> CANONICAL memory -> journaled compaction if needed`

Handoff perception memory:

`handoff guard acceptance -> recipient wake/specialists -> OBSERVED perception memory -> journaled compaction if needed -> relay -> sleep`

Reload recovery:

`parse snapshot -> backfill non-canonical fields -> recover pending compaction -> return world`

A rejected canonical event creates no memory.

A rejected, duplicate, future-revision, or otherwise invalid handoff creates no recipient lifecycle and no perception memory.

## Boundary

The journal is serialized inside the current JSON snapshot model. The proof shows deterministic recovery from persisted intermediate states. It does not yet show atomic filesystem writes, fsync durability, process-kill recovery during the act of writing a snapshot, or recovery from corruption of both journal images.
