# AXM EchoWorld

EchoWorld is an experimental deterministic persistent-cell world harness.

**v0.01 question:** can small persistent world cells retain bounded experience and spawn only relevant temporary specialist work while canonical physical truth remains deterministic, replayable, and protected from experiential authority?

## Local consumer boundary

The deterministic event-to-truth core can be packed for another local Node.js project without repository-relative imports. The installed `echoworld-replay` command creates and independently re-executes portable event-stream receipts. See [CONSUMER.md](CONSUMER.md). No registry release is published.

EchoWorld also exposes one source-backed `EXPERIMENTAL` public capability declaration through the repository discovery contract. Discovery is evidence only: it does not execute, install, automatically select, merge, or canonize the capability.

## Integration state

The previously stacked v0.01 core, persistence/recovery, writer-lease, portable replay, discovery, CI-identity, and observer/experience lanes have been consolidated onto `main`.

Future implementation work still follows the one-chat/one-lane coordination rule in `AGENTS.md`. Lane ownership and technical merge permission are coordination mechanisms, not constitutional authority.

## Implemented proof surface

- deterministic 16x16 default world with stable cell IDs
- canonical MOVE / DAMAGE_STRUCTURE / FIRE rules and SHA-256 truth hash
- truth-before-memory ordering
- bounded `CANONICAL` and `OBSERVED` memory with provenance-aware compaction
- deterministic temporary specialist proposals, stale rejection, and conflict preservation
- bounded handoff guards, queued scheduling, resource budgets, and replay evidence
- accepted SOUND handoff lifecycle: wake, specialists, perception, optional memory, relay, sleep
- persistent deferred delivery for simulated busy cells
- interruption-safe copy-on-write memory compaction and explicit `REPAIR`
- integrity-wrapped atomic complete-world snapshots
- primary / backup / temp / recovery-temp candidate inspection
- process-exit recovery across save and recovery-promotion stages
- complete selected snapshot-parent and fencing lineage verification
- deterministic portable recovery capsules containing one verified snapshot and its selected lineage
- caller-pinned, empty-target restore when ordinary local candidates are unusable
- append-only single-writer lease records with monotonic fencing tokens
- claim/activation/heartbeat/base/release linkage to the originating lease identity
- preservation of invalid raw lease evidence during bounded archival
- provisional claims, activation, heartbeat renewal, base records, and durable release records
- stale-owner takeover after lease expiry
- checkpoint admission bound to writer ID, lease ID, fencing token, durable base, canonical hash, and operational hash
- operational checkpoint evidence for scheduler queues, deferred mailboxes, pending compactions, seen ledgers, and cell activation state
- legacy atomic snapshot v0.01 validation plus fenced snapshot v0.02
- fencing-aware rejection of older leased temp/recovery-temp candidates
- current-owner checks at persistence authority boundaries
- stale-base rejection before primary installation
- crash-tested lease acquisition and release recovery
- portable offline event-stream replay package with independent deterministic receipt verification
- exact-source and exact synthetic merge-candidate CI identity checks
- immutable GitHub Action commit pins in the critical EchoWorld test workflow
- source-backed public capability discovery with a pinned Discovery Buddy interoperability bridge
- offline non-authoritative causal observer generated from real core receipts
- directly inspectable 16x16 cell grid with keyboard/assistive semantics
- receipt-declared consequence navigation across canonical changed cells without browser mutation authority

## Core authority boundary

Canonical physical truth contains world revision, actor positions, and cell physical state.

Memory, perception, wake state, specialists, handoff guards, scheduler jobs, deferred mailboxes, compaction journals, lease records, fencing tokens, checkpoint receipts, candidate filenames, persistence receipts, replay receipts, discovery records, and observer state do not become physical truth authority merely by existing.

A failed canonical transition creates no canonical memory. An accepted handoff may create only an `OBSERVED` memory. Specialist finish order cannot grant mutation authority.

A snapshot is accepted only when its payload integrity, deterministic identity, world schema, canonical hash, and optional checkpoint admission all validate.

## Cooperative single-writer protocol

A writer first acquires an append-only claim with a monotonic fencing token. The winning claim activates a time-bounded lease and records the durable snapshot base it observed.

A leased checkpoint then follows:

```text
acquire / renew lease
→ verify current owner and expected durable base
→ inspect checkpoint barrier
→ create deterministic checkpoint admission
→ write fenced temp snapshot
→ re-check lease at write boundaries
→ verify primary still matches admitted base
→ atomically install and verify next generation
```

Checkpoint admissions include:

- `writerId`
- `leaseId`
- `fencingToken`
- admitted base generation and snapshot ID
- world revision
- canonical hash
- operational hash and counts
- deterministic checkpoint ID

A higher fencing token makes an older **leased** temp or recovery-temp ineligible for recovery promotion. A stale lease cannot use the leased checkpoint API after takeover.

Closed lease evidence can be archived under the tested bounded archival contract. Invalid raw records are preserved as evidence instead of being silently compacted away, and the active fencing token is protected from archival.

## Checkpoint barrier

By default, a checkpoint is admitted only when every cell is in `DORMANT` or explicit `REPAIR` state.

The operational hash covers selected deterministic coordination projections for:

- active scheduler queues
- deferred mailboxes
- pending memory-compaction journals
- seen handoff/event ledgers
- cell wake and activation evidence

The complete world payload remains protected separately by its payload SHA-256. The operational hash is a coordination witness, not a replacement for the full payload hash.

## Run

Requires Node.js 20+.

```bash
npm test
npm run benchmark
npm run observer:build
```

Open `observer/index.html` directly in a browser to step through a deterministic input → truth → observation proof. The generated observer is an offline, non-authoritative projection of real core receipts; it does not simulate or mutate canonical state in the browser.

## Current evidence

The final consolidated observer/discovery source head used for the last capability integration was independently exercised by GitHub Actions:

- **EchoWorld v0.01 tests run `34690578038`: SUCCESS**
- exact source-head job: PASS
- exact synthetic merge-candidate job: PASS
- immutable-action-pin gate: PASS
- deterministic repository suite: **138/138 PASS**, 0 failed
- source head: `275c78320b2b354da87f458d67f35bc537af3b42`
- **Public capability discovery run `34690578032`: SUCCESS**
- generated discovery contract: PASS on Node 20 and Node 22
- focused discovery regressions: PASS
- complete deterministic suite inside discovery gate: PASS
- real executable capability descriptor: PASS
- pinned Discovery Buddy public scan/verify bridge: PASS

The observer Experience layer also retains its earlier Chromium evidence for desktop/mobile cell inspection and receipt-declared consequence navigation. That visual evidence is presentation evidence only; the browser does not become canonical truth authority.

See:

- `docs/WRITER_LEASE.md`
- `docs/ATOMIC_PERSISTENCE.md`
- `docs/PORTABLE_RECOVERY_CAPSULE.md`
- `CONSUMER.md`
- `DISCOVERY.md`
- `evidence/writer-lease-fencing-latest.json`
- `evidence/test-receipt-latest.json`
- `evidence/atomic-snapshot-recovery-latest.json`
- `evidence/memory-compaction-recovery-latest.json`

## Honest boundary

This remains an **experimental cooperative local-filesystem writer-fencing and deterministic-world proof** on the tested environments.

It does not prove that a hostile or buggy process bypassing the lease API cannot edit snapshot files directly. A durable-base check detects tested non-cooperating base changes before leased primary installation, but it is not an operating-system security boundary.

Lease expiry currently depends on supplied millisecond time. Tests use explicit deterministic values, but cross-machine clock skew, clock rollback, suspended processes, and distributed lease semantics remain unproven.

Lease archival is now implemented for the tested local protocol, including fail-closed invalid-record preservation. That does not establish a universal long-term retention policy, distributed garbage collection, or hostile-filesystem security.

Also unproven:

- sudden power-loss and storage-controller durability beyond the tested interruption points
- every filesystem and operating system
- network filesystem or cross-device rename semantics
- hostile multi-process enforcement
- fully atomic in-memory mutation plus durable checkpoint commit
- bounded snapshot-lineage retention
- automatic external recovery discovery or in-place adoption when local candidates are corrupt
- production-scale performance and massive-world scaling
- realistic physical propagation
- genuine concurrent cell execution and scheduler fairness
- multiplayer/network determinism
- independent parallel specialist workers
- emergent-story quality
- AI integration

No AI belongs in v0.01.
