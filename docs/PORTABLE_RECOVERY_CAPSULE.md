# Portable Snapshot Recovery Capsule

EchoWorld can export one selected atomic snapshot and its complete verified parent lineage as:

`axm.echoworld.snapshot-recovery-capsule/v0.01`

The capsule is deterministic: unchanged snapshot and lineage state produce byte-identical capsule text and the same `SRC_...` identity.

## Admission contract

Creation requires the valid installed primary snapshot and a complete, contiguous lineage ending at that exact snapshot. A higher temporary or backup candidate must pass ordinary local recovery first; capsule creation cannot silently promote it. The capsule embeds:

- the full integrity-wrapped snapshot envelope;
- only the selected lineage chain, without abandoned branch records;
- the capsule ID derived from both structures.

Restore validates the capsule, snapshot payload, canonical hash, checkpoint evidence, every sealed lineage record, parent continuity, fencing progression, and the caller-supplied expected capsule ID before writing.

## Non-overwrite boundary

Restore targets an empty store namespace. It refuses a different valid, corrupt, conflicting, temporary, or backup candidate instead of replacing local evidence. A retry may continue from matching lineage records, and replaying an already restored pinned capsule returns `ALREADY_RESTORED`.

To recover when every ordinary local candidate is corrupt, keep the damaged directory unchanged and restore the pinned capsule into a separate directory. Selecting or replacing the active store remains an explicit caller decision.

## What this does not claim

- The SHA-256 identity is integrity evidence, not a signature or author identity.
- EchoWorld does not discover, upload, download, or trust external sources automatically.
- No network, cloud, account, AI, or new world authority is introduced.
- Capsule export must happen before the local store is lost.
- This does not bound snapshot-lineage growth or guarantee every filesystem/power-loss behavior.
