# EchoWorld v0.01 Architecture

The v0.01 harness keeps canonical physical truth and experiential/advisory state separate.

## Event lifecycle

For a committed event, the current prototype follows:

`event -> validate -> wake affected cells -> create bounded relevant specialist proposals -> deterministic proposal merge gate -> canonical event rule + commit -> truth receipt -> bounded memory update from committed event -> bounded handoff emission -> sleep`

The specialist proposal merge gate runs against the current base revision before the canonical event rule commits. It does not itself mutate physical truth.

## Authority boundary

Canonical truth contains world revision, actor positions, and cell physical truth state. Memory, specialist receipts, specialist merge receipts, handoff receipts, handoff guard state, wake state, and other experiential bookkeeping are excluded from the canonical hash.

Memory may retain, compact, or forget experiential history. It cannot rewrite canonical physical truth.

Specialists produce proposal receipts only. They do not directly mutate canonical truth.

Conflicting specialist proposals are sorted into a deterministic conflict receipt and rejected from canonical mutation. Worker finish order therefore cannot grant truth authority.

## Handoff boundary

Generated handoffs carry causal depth, a hop limit, and a causal path. The guard layer rejects:

- duplicate event IDs already accepted;
- unknown sender/recipient cells;
- invalid hop budgets;
- events beyond their hop limit;
- causal cycles where the recipient already appears in the path.

`propagateAcceptedHandoff` is an explicit bounded propagation primitive. A terminal hop produces no further handoffs. This is not yet a full queued autonomous world-propagation scheduler.

Recipient cells are not directly rewritten by the sender or by the handoff guard/propagation layer.

## Specialist merge boundary

Specialist receipts are checked against the world revision they observed.

- stale base revision -> rejected;
- non-proposed status -> rejected;
- identical proposals for one target -> represented as one gate decision with all run IDs preserved;
- contradictory proposals for one target -> deterministic conflict receipt, no selected proposal, no canonical mutation.

This proves order-independent conflict preservation for the current harness. It is not yet a domain-specific policy for deciding how a future canonical rule should resolve a real physical conflict.

## A/B proof

The same starter event stream is run with memory disabled and enabled. Both modes must produce the same canonical physical hash.

The memory-enabled mode may produce additional memory, specialist, merge, and handoff bookkeeping, but those outputs are not canonical physics.

## Persistence

v0.01 includes a JSON serialization/reload proof. This demonstrates deterministic state roundtrip for the tiny harness, not crash-safe durable storage.
