# EchoWorld v0.01 Atomic Persistence

EchoWorld has an integrity-wrapped atomic snapshot store for complete serialized world state, now extended with optional fenced checkpoint admissions.

The implementation remains under `src/persistence/` in `chatgpt/echoworld-lane-01`.

## Purpose

The base snapshot protocol asks:

> After an abrupt process exit during a tested save or recovery stage, can EchoWorld reject corrupt candidates, select the newest non-conflicting valid generation, and restore it without changing canonical truth?

The fenced extension asks:

> Can a cooperative current writer bind a coherent checkpoint to its lease token and durable base so stale writers and older leased transients cannot silently become the next world?

The current evidence supports both questions for the tested local Ubuntu CI environment and cooperative API.

## Schemas

Current snapshot envelope:

`axm.echoworld.atomic-snapshot/v0.02`

Legacy readable envelope:

`axm.echoworld.atomic-snapshot/v0.01`

Current save/recovery receipt:

`axm.echoworld.atomic-snapshot-receipt/v0.02`

Current inspection receipt:

`axm.echoworld.atomic-snapshot-inspection/v0.02`

Checkpoint admission:

`axm.echoworld.checkpoint-admission/v0.01`

## Candidate files

For store name `world`:

- `world.snapshot.json`: primary
- `world.snapshot.backup.json`: previous primary
- `world.snapshot.tmp.json`: save candidate
- `world.snapshot.recover.tmp.json`: recovery-promotion candidate
- `world.snapshot.backup.tmp.json`: internal backup-write candidate

All persistent candidates use UTF-8 JSON.

## Envelope v0.02

Every current envelope contains:

```text
schema
generation
parentSnapshotId
worldSchema
canonicalHash
payloadHash
payloadEncoding
payload
checkpoint
snapshotId
```

`checkpoint` may be null for the unleased compatibility API.

The deterministic snapshot ID covers the checkpoint when present, so checkpoint tampering invalidates snapshot identity.

A candidate is valid only when:

1. JSON parses;
2. schema is current v0.02 or supported legacy v0.01;
3. generation is a positive integer;
4. payload encoding and shape are valid;
5. payload SHA-256 matches;
6. deterministic snapshot ID matches;
7. optional checkpoint schema and ID validate;
8. optional checkpoint base matches generation and parent;
9. unrecovered world reload succeeds;
10. world schema and canonical hash match;
11. optional checkpoint world revision, canonical hash, and operational hash match the unrecovered payload;
12. normal non-canonical recovery succeeds;
13. recovered canonical hash remains unchanged.

A claimed high generation receives no preference unless every relevant check passes.

## Generation and lineage

A new generation uses:

```text
generation = selected current generation + 1
parentSnapshotId = selected current snapshotId
```

A leased checkpoint additionally records the admitted base generation and snapshot ID, which must equal the snapshot parent relationship.

The current protocol verifies the candidate and immediate parent relationship. It does not yet traverse and prove the full historical chain.

## Candidate selection

Recovery inspects:

1. primary
2. backup
3. temp
4. recovery-temp

Base selection rule:

`highest eligible valid generation wins`

Identical highest-generation candidates use stable role priority:

`primary -> temp -> recovery-temp -> backup`

Different valid identities at the same highest eligible generation produce:

`SNAPSHOT_GENERATION_CONFLICT`

No valid candidate produces:

`NO_VALID_SNAPSHOT`

When a fencing policy excludes all otherwise valid candidates, recovery reports `NO_ELIGIBLE_SNAPSHOT`, except for the explicit first-generation case where only older fenced transients exist. That case discards the transients and returns an empty durable base.

## Fencing-aware candidate policy

The writer lease supplies a candidate policy for leased acquisition and leased checkpointing.

For `temp` and `recoveryTemp` only:

```text
candidate checkpoint fencingToken < current fencingToken
→ FENCED_UNCOMMITTED_CANDIDATE
```

Primary and backup remain eligible committed generations.

The policy prevents the tested old leased temp from being promoted after higher-token takeover. It does not retroactively fence legacy uncheckpointed v0.01 transient candidates because they carry no writer token.

## Save protocol

Before writing a new generation, save runs deterministic recovery on the existing store.

Normal sequence:

1. recover the current eligible base;
2. optionally verify expected base generation and snapshot ID;
3. create the envelope;
4. run the write authority guard after base recovery;
5. write temp;
6. invoke `AFTER_TEMP_WRITE`;
7. fsync temp;
8. invoke `AFTER_TEMP_FSYNC`;
9. run authority guard;
10. preserve current primary through synced backup-temp and rename;
11. fsync directory;
12. run authority guard;
13. re-check owner and installed primary base immediately before primary rename;
14. atomically rename temp to primary;
15. invoke `AFTER_PRIMARY_RENAME`;
16. fsync directory;
17. invoke `AFTER_PRIMARY_DIRECTORY_FSYNC`;
18. run authority guard;
19. reopen and verify installed primary;
20. run final authority guard;
21. clean transient paths.

The unleased `saveAtomicWorldSnapshot()` remains available for compatibility and tests. Cooperative single-writer protection is provided by `saveLeasedAtomicWorldSnapshot()`.

## Write authority boundaries

The atomic store exposes named boundaries:

- `AFTER_BASE_RECOVERY`
- `BEFORE_TEMP_WRITE`
- `AFTER_TEMP_FSYNC`
- `BEFORE_BACKUP_COPY`
- `AFTER_BACKUP_DIRECTORY_FSYNC`
- `BEFORE_PRIMARY_RENAME`
- `AFTER_PRIMARY_DIRECTORY_FSYNC`
- `AFTER_PRIMARY_VERIFY`

The leased wrapper reasserts ownership at these boundaries and checks primary base identity before installation.

These are explicit cooperative checks. They are not a kernel-level atomic compare-and-swap between the final check and rename.

## Recovery promotion

When selected candidate is not primary:

1. write selected candidate to recovery-temp;
2. fsync recovery-temp;
3. invoke `AFTER_RECOVERY_TEMP_FSYNC`;
4. rename recovery-temp to primary;
5. invoke `AFTER_RECOVERY_PRIMARY_RENAME`;
6. fsync directory;
7. invoke `AFTER_RECOVERY_DIRECTORY_FSYNC`;
8. reopen and verify primary against selected snapshot ID;
9. clean transients.

Recovery remains restartable after interruption at the tested stages.

## Abrupt process-exit evidence

Base snapshot save exits:

- `AFTER_TEMP_WRITE`
- `AFTER_TEMP_FSYNC`
- `AFTER_BACKUP_RENAME`
- `AFTER_BACKUP_DIRECTORY_FSYNC`
- `AFTER_PRIMARY_RENAME`
- `AFTER_PRIMARY_DIRECTORY_FSYNC`

Recovery-promotion exits:

- `AFTER_RECOVERY_TEMP_FSYNC`
- `AFTER_RECOVERY_PRIMARY_RENAME`
- `AFTER_RECOVERY_DIRECTORY_FSYNC`

Lease record exits:

- `AFTER_CLAIM_FSYNC`
- `AFTER_ACTIVATION_FSYNC`
- `AFTER_BASE_RECORD_FSYNC`
- `AFTER_RELEASE_FSYNC`

Child processes use exit code `86`. Later processes recover the expected snapshot or acquire a higher writer token according to the tested stage.

## Checkpoint admission interaction

A leased v0.02 snapshot binds:

- writer identity and lease ID;
- fencing token;
- admitted durable base;
- canonical hash and revision;
- selected operational coordination state.

Validation first checks the checkpoint against the unrecovered payload. This matters when a snapshot intentionally contains a pending compaction journal. After that evidence is validated, normal reload recovery may complete the journal before returning the world.

## Interaction with canonical truth

The envelope records canonical hash and rejects disagreement after reload.

Lease records, fencing tokens, checkpoint admissions, candidate roles, generation bookkeeping, and persistence receipts remain outside canonical rule authority.

Persistence chooses and verifies complete world snapshots. It does not decide physical rules or promote memory/perception into truth.

## Current evidence

GitHub Actions implementation checkpoint:

- head `6455d5dd4dc2d0609ab13ca38e096ca2fee63fc9`
- run `33405590474`
- job `99532258471`
- Node.js v22.23.2
- Ubuntu 24.04.4
- 85 tests passed, 0 failed
- duration `2086.800059 ms`

See `docs/WRITER_LEASE.md` for the lease protocol and `evidence/writer-lease-fencing-latest.json` for the dedicated proof receipt.

## Claim boundary

### Process exit is not power loss

`AFTER_TEMP_WRITE` occurs before temp-file fsync. Survival after tested process exit does not establish sudden-power-loss durability.

### Cooperative writers

The lease and fencing protocol protects writers that use the API. A process with raw filesystem access can bypass it.

### Time

Lease expiry uses supplied milliseconds. Cross-machine skew, clock rollback, suspended processes, and distributed consensus are not solved.

### Final-check interval

There is a narrow interval between final lease/base assertion and primary rename. No platform-enforced CAS currently closes that interval.

### Platform

The protocol is tested on GitHub Actions Ubuntu. Every filesystem, operating system, network filesystem, cross-device path, and storage controller is not covered.

### Ledger and lineage

Lease records are append-only without verified garbage collection. Snapshot lineage records the immediate parent but does not yet prove the complete chain.

### Transaction

The checkpoint hashes canonical and operational state and requires quiescent cell states, but the API does not freeze arbitrary caller mutation through the full save duration. A stronger mutation-session boundary remains future work.

## Next persistence work

1. safe writer-lease ledger archival and compaction;
2. monotonic-clock and rollback-resistant lease timing;
3. stronger compare-and-swap or platform-lock enforcement;
4. complete parent-chain plus fencing lineage verification;
5. explicit mutation/checkpoint session with frozen admission state;
6. heartbeat and checkpoint-stage process-exit tests;
7. platform/filesystem matrix;
8. power-failure experiments on controlled hardware;
9. dedicated lease and atomic persistence benchmarks;
10. trusted external recovery when all local candidates are invalid.
