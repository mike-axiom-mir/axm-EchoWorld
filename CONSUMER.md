# Consume EchoWorld locally

EchoWorld's experimental event-to-truth boundary is available as a bounded,
dependency-free Node.js package. It runs offline and requires no account,
cloud service, AI model, telemetry, or network connection.

Build a local tarball from a reviewed checkout:

```bash
npm pack --ignore-scripts
```

Install it into another project without contacting a registry:

```bash
npm install --offline /path/to/axm-echoworld-0.0.1.tgz
echoworld-replay describe
echoworld-replay example > events.json
echoworld-replay run events.json > replay.json
echoworld-replay verify replay.json
```

Library consumers can use the same verified seam:

```js
import {
  createPortableReplay,
  verifyPortableReplay
} from "axm-echoworld";

const receipt = createPortableReplay({
  schema: "axm.echoworld.event-stream/v0.01",
  width: 8,
  height: 8,
  events: [{
    eventId: "MOVE_1",
    type: "MOVE",
    actorId: "A",
    x: 2,
    y: 1
  }]
});

console.log(receipt.canonicalEquivalent); // true
console.log(verifyPortableReplay(receipt).verified); // true
```

The receipt embeds the bounded input and the final canonical projection. Its
verifier checks receipt integrity and then reruns both memory-disabled and
memory-enabled execution. Recalculating the receipt hash after changing a
claimed result does not make that result pass replay.

This package remains `private`: the lane enables reviewed local tarball handoff,
not registry publication or a stable cross-engine 1.0 contract. Deterministic
hashes prove equality and byte integrity, not authorship, honest input, physical
realism, or CANON status.
