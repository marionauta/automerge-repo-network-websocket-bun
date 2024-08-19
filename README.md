# automerge-repo-network-websocket-bun

An [automerge][automerge] [repo][automerge-repo] network adapter that uses
Bun's [server side WebSockets][bunws] to share documents.

The code is mostly from the [official node implementation][amws] but modified
to work with Bun.

## Usage

```typescript
import { Repo } from "@automerge/automerge-repo";
import { BunWSServerAdapter } from "automerge-repo-network-websocket-bun";

const socketAdapter = new BunWSServerAdapter();

const repo = new Repo({
  network: [socketAdapter],
  // ...
});

Bun.serve({
  fetch(request, server) {
    // request upgrade logic
  },
  websocket: socketAdapter,
})
```

[automerge]: https://automerge.org
[automerge-repo]: https://github.com/automerge/automerge-repo
[bunws]: https://bun.sh/docs/api/websockets
[amws]: https://github.com/automerge/automerge-repo/tree/main/packages/automerge-repo-network-websocket
