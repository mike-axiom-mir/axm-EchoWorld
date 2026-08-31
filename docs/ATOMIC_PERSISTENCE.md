# EchoWorld v0.01 Atomic Persistence

EchoWorld now has an integrity-wrapped atomic snapshot store for its complete serialized world state.

The implementation lives under `src/persistence/` and remains part of `chatgpt/echoworld-lane-01`.

## Purpose

The store addresses a narrower question than “perfect durable storage”:

> After an abrupt process exit during a tested save or recovery stage, can EchoWorld inspect the surviving files, reject corrupt candidates, select the newest non-conflicting valid generation, and restore it without changing canonical truth?

The current evidence answers **yes for the tested Linux CI environment and stages**.

It does not establish sudden power-loss, storage-controller, every-filesystem, or multi-writer guarantees.

## Schemas

Snapshot envelope:

`axm.echoworld.atomic-snapshot/v0.01`

Save/recovery receipt:

`axm.echoworld.atomic-snapshot-receipt/v0.01`

Inspection receipt:

`axm.echoworld.atomic-snapshot-inspection/v0.01`

## Files

For store name `world`:

- `world.snapshot.json`: primary candidate
- `world.snapshot.backup.json`: previous primary candidate
- `world.snapshot.tmp.json`: save candidate
- `world.snapshot.recover.tmp.json`: recovery-promotion candidate
- `world.snapshot.backup.tmp.json`: internal backup-write candidate

All persistent candidates use UTF-8 JSON.

## Integrity envelope

Each snapshot envelope contains:

```text
schema
generation
parentSnapshotId
worldSchema
canonicalHash
payloadHash
payloadEncoding
payload
snapshotId
```

`payload` is the complete `persistWorld(world)` string.

`payloadHash` is SHA-256 over that exact payload string.

`snapshotId` is deterministic over the envelope identity fields except `snapshotId` itself.

A candidate is valid only when:

1. envelope JSON parses;
2. schema matches;
3. generation is an integer of at least 1;
4. payload encoding and payload shape are valid;
5. payload SHA-256 matches;
6. deterministic snapshot ID matches;
7. `reloadWorld(payload)` succeeds;
8. reloaded world schema matches;
9. the reloaded world's canonical hash matches the envelope.

A candidate that merely claims a high generation receives no preference unless it passes every check.

## Generation and lineage

A new save uses:

```text
generation = selected current generation + 1
parentSnapshotId = selected current snapshotId
```

The protocol currently verifies the candidate itself and records its immediate parent ID.

It does not yet walk and prove the complete historical parent chain.

## Candidate selection

Recovery inspects:

1. primary
2. backup
3. temp
4. recovery-temp

It considers only valid candidates.

Selection rule:

```text
highest valid generation wins
```

When several highest-generation candidates have the same snapshot ID, stable role priority is:

```text
primary
→ temp
→ recovery-temp
→ backup
```

When different valid snapshots claim the same highest generation, recovery fails closed with:

`SNAPSHOT_GENERATION_CONFLICT`

It does not choose whichever file happens to be listed first.

When files exist but no candidate is valid, recovery fails with:

`NO_VALID_SNAPSHOT`

A new save refuses to overwrite such a store.

## Save protocol

Before writing a new generation, save first runs deterministic recovery on the existing store.

The normal save sequence is:

1. write complete envelope to temp;
2. invoke `AFTER_TEMP_WRITE`;
3. fsync temp file;
4. invoke `AFTER_TEMP_FSYNC`;
5. copy the current primary into backup-temp;
6. fsync backup-temp;
7. rename backup-temp to backup;
8. invoke `AFTER_BACKUP_RENAME`;
9. fsync the directory;
10. invoke `AFTER_BACKUP_DIRECTORY_FSYNC`;
11. atomically rename temp to primary;
12. invoke `AFTER_PRIMARY_RENAME`;
13. fsync the directory;
14. invoke `AFTER_PRIMARY_DIRECTORY_FSYNC`;
15. reopen and verify the installed primary;
16. remove transient files.

The first generation has no existing primary to preserve as backup.

File mode for newly written snapshot candidates is `0600`.

Directory fsync is required by default. When the platform refuses it with a known unsupported error, the store fails with `DIRECTORY_FSYNC_UNSUPPORTED` unless the caller explicitly disables that requirement.

## Recovery protocol

When the selected candidate is not already primary:

1. write selected candidate text to recovery-temp;
2. fsync recovery-temp;
3. invoke `AFTER_RECOVERY_TEMP_FSYNC`;
4. atomically rename recovery-temp to primary;
5. invoke `AFTER_RECOVERY_PRIMARY_RENAME`;
6. fsync the directory;
7. invoke `AFTER_RECOVERY_DIRECTORY_FSYNC`;
8. reopen and verify primary against the selected snapshot ID;
9. clean transient files.

If recovery itself exits at one of these stages, a later recovery can inspect the surviving primary, backup, temp, and recovery-temp candidates again.

## Abrupt process-exit tests

The tests launch child Node.js processes and call `process.exit(86)` at exact stages.

Save stages:

- `AFTER_TEMP_WRITE`
- `AFTER_TEMP_FSYNC`
- `AFTER_BACKUP_RENAME`
- `AFTER_BACKUP_DIRECTORY_FSYNC`
- `AFTER_PRIMARY_RENAME`
- `AFTER_PRIMARY_DIRECTORY_FSYNC`

Recovery-promotion stages:

- `AFTER_RECOVERY_TEMP_FSYNC`
- `AFTER_RECOVERY_PRIMARY_RENAME`
- `AFTER_RECOVERY_DIRECTORY_FSYNC`

After every tested exit, a new process performs recovery and obtains generation 2 with the expected canonical state.

### Important distinction

`AFTER_TEMP_WRITE` occurs before file fsync.

The test proves that the valid temp file remained available after the tested process exit on GitHub's Ubuntu filesystem. It does not prove that the file would survive sudden power loss at that stage.

## Corruption and conflict tests

The suite also verifies:

- corrupt primary falls back to valid backup and promotes it;
- a valid higher-generation temp beats an older valid primary;
- an invalid high-looking temp is ignored;
- payload tampering fails at the payload hash;
- identical same-generation candidates select primary deterministically;
- different valid same-generation candidates stop with conflict;
- an existing store with no valid candidate is not overwritten;
- atomic load triggers pending memory-compaction recovery.

## Interaction with canonical truth

The envelope records the world canonical hash, and validation recomputes it after reload.

Snapshot role, generation metadata, backup files, temp files, receipts, and recovery choice do not alter canonical world rules.

Loading a snapshot may deterministically repair non-canonical pending memory-compaction state through the existing `reloadWorld()` recovery path. The test confirms that this does not change the canonical hash.

## What this proves

Observed in the tested CI environment:

- complete integrity-checked generation envelopes;
- deterministic candidate selection;
- fail-closed same-generation conflict handling;
- backup fallback;
- temp promotion;
- file fsync and directory fsync calls;
- atomic rename installation on the tested filesystem;
- restartable recovery promotion;
- recovery after nine abrupt process-exit stages;
- preservation of expected canonical state;
- compatibility with pending compaction recovery.

## What this does not prove

- sudden power-loss durability;
- storage-controller cache flush guarantees;
- behavior on every filesystem or operating system;
- cross-device rename atomicity;
- network filesystem semantics;
- a single-writer lock or multi-process writer lease;
- protection against two simultaneous valid writers creating competing generations;
- complete parent-chain verification;
- transactions spanning world mutation, active scheduler queue, deferred mailbox, and compaction journal;
- automatic recovery when all candidates are invalid;
- production-scale throughput or latency.

The strongest next persistence seam is a deterministic single-writer lease plus a checkpoint admission barrier, followed by a shared transaction/checkpoint boundary for queue, mailbox, and compaction state.
