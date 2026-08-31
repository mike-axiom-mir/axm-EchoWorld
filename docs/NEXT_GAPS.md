# Next Gaps

The next work should strengthen deterministic proof rather than add product layers.

## Completed in lane 01

- deterministic canonical world rules and hashing
- bounded CANONICAL and OBSERVED memory
- temporary specialist proposals and deterministic merge
- bounded handoff guards and queued scheduling
- SOUND recipient lifecycle
- persistent deferred delivery for busy cells
- interruption-safe copy-on-write compaction
- atomic integrity-wrapped snapshots and process-exit recovery
- primary / backup / temp / recovery-temp validation
- monotonic append-only writer fencing tokens
- provisional claims, activation, heartbeat, durable base, and release records
- one-active-writer cooperative election
- stale-owner takeover and old-handle fencing
- checkpoint quiescence barrier
- checkpoint canonical and operational evidence
- snapshot v0.02 checkpoint integration with v0.01 legacy reads
- leased snapshot base comparison
- fencing of older leased transient candidates
- lease assertions around atomic write boundaries
- lease claim/activation/base/release process-exit tests
- 85-test GitHub Actions checkpoint
- source-honest evidence and claim boundaries

## Priority order now

1. **Lease-ledger archival and bounded retention**
   - preserve monotonic fencing evidence
   - checkpoint old claims/heartbeats/releases
   - prove safe deletion or archival rules

2. **Clock hardening**
   - monotonic local clock abstraction
   - rollback detection
   - process/VM suspension handling
   - restart continuity evidence

3. **Stronger persisted compare-and-swap**
   - platform-native lock or owner file beneath cooperative fencing
   - narrow/close the interval between final assertion and primary rename
   - prove stale writers cannot install after takeover

4. **Immutable checkpoint session**
   - freeze or hand off an immutable world snapshot at admission
   - detect caller mutation between admission and serialization
   - bind canonical state, queues, mailboxes, compaction journals, and receipts to one checkpoint object

5. **Complete snapshot and fencing lineage**
   - walk parent IDs
   - verify generation continuity
   - verify fencing-token transitions
   - define bounded historical retention

6. **More lease fault injection**
   - heartbeat-write interruption
   - every leased write-authority boundary
   - stale release after replacement commit
   - contender crash during election

7. **High-contention and fairness evidence**
   - many local contenders
   - deterministic election receipts
   - starvation/fairness policy
   - unrelated schedulers competing for one cell

8. **Platform and durability matrix**
   - Linux filesystem variants
   - Windows
   - macOS
   - controlled network-filesystem experiments
   - power-loss testing on controlled hardware where practical

9. **External recovery**
   - trusted lineage or archive when every local snapshot candidate is invalid
   - corrupt-before memory repair from trusted evidence
   - lossless queue/mailbox overflow lineage

10. **Long-stream and scale measurements**
    - mixed-event property tests
    - lease-ledger growth
    - checkpoint/persistence latency
    - larger sleeping-world activation and storage

11. **World-domain growth after substrate proof**
    - material-aware attenuation
    - richer deterministic propagation
    - cross-revision paused-work policy
    - genuine concurrent execution experiments

## Boundaries that must remain visible

- cooperative writer protocol, not hostile filesystem security
- local supplied milliseconds, not distributed consensus time
- no universal sudden-power-loss guarantee
- no complete lineage proof yet
- no full caller-mutation freeze yet
- no performance or massive-world claim yet
- no AI in v0.01

Keep all work for this chat on `chatgpt/echoworld-lane-01`.
