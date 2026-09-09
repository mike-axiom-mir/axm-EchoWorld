# EchoWorld public capability discovery

This lane makes the portable deterministic event-replay capability introduced by draft PR #7 discoverable without turning discovery into execution authority.

## Source capability

The declaration is generated from the real package boundary:

- metadata: `package.json` -> `axmCapability`
- executable descriptor: `src/capability.js` -> `describeCapability()`
- license: `LICENSE`
- capability: `axm.echoworld.deterministic-event-replay`
- status: `EXPERIMENTAL`
- runtime: local Node.js 20+, no network dependency

The generator requires the package metadata and executable descriptor to remain semantically identical. It also records exact Git blob identities for those source files and rejects source symlink substitution.

## Consumer bridge

`.axm/discovery-public.json` explicitly opts this repository into the bounded public-safe discovery contract consumed by `mike-axiom-mir/axm-discovery-buddy`.

The dedicated CI workflow checks Discovery Buddy out at exact ref `1a94fc2481d1cfc9234dea7c86af4777126d3924`, scans this repository in public mode, exact-verifies the generated index, and requires exactly one EchoWorld capability record with `EXPERIMENTAL` preserved.

Discovery says only that a source-backed capability declaration exists. It does not install the package, select it for a caller, execute an event stream, authenticate an author, merge a branch, release a package, or declare CANON.

## Dependency

This work is intentionally stacked on EchoWorld draft PR #7 exact head `ea7c3b654a05de19a40a4e7b3a17ffa05cf9d800`. PR #7 owns the portable package/library/CLI and runtime replay proof. This lane only exposes that already-bounded capability to deterministic fleet discovery.

## Pattern provenance

The generated-registry/discovery-consumer pattern is adapted from the already-tested public discovery seam in `mike-axiom-mir/axm-ignition-fabric` at exact ref `4320b5749980639273ec791c8dde90f880f9f0bf`.

The EchoWorld implementation was rewritten for EchoWorld's package identity, Node 20 runtime, event-stream/replay contracts, and authority boundary. No Ignition runtime code is copied or required.

## Regeneration

```bash
node tools/generate-public-capabilities.mjs --write
node tools/generate-public-capabilities.mjs --check
node --test tests/public-capability-discovery.test.mjs
```

The generated files are:

- `registry/capabilities.jsonl`
- `registry/capabilities.receipt.json`

A mismatch is a review signal. The checker never silently rewrites committed evidence.
