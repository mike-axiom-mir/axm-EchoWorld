# EchoWorld v0.01 Architecture

The v0.01 harness keeps canonical truth and experiential state separate.

## Event lifecycle

`event -> validate -> wake affected cells -> spawn bounded relevant specialist proposals -> canonical commit -> write truth receipt -> update bounded memory from committed event -> emit bounded handoff receipts -> sleep`

## Authority boundary

Canonical truth contains world revision, actor positions, and cell physical truth state. Memory, specialist receipts, handoff receipts, wake state, and other experiential bookkeeping are excluded from the canonical hash.

Memory may retain, compact, or forget experiential history. It cannot rewrite canonical physical truth.

Specialists currently produce proposal receipts only. They do not directly mutate canonical truth.

Handoffs currently produce bounded first-hop event receipts only. Recipient cells are not directly rewritten by the sender.

## A/B proof

The same starter event stream is run with memory disabled and enabled. Both modes must produce the same canonical physical hash.

The memory-enabled mode may produce additional memory and specialist receipts, but those outputs are not canonical physics.

## Persistence

v0.01 includes a JSON serialization/reload proof. This demonstrates deterministic state roundtrip for the tiny harness, not crash-safe durable storage.
