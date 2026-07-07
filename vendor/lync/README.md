# Lync

Lync is a small TypeScript toolkit for local-first branching documents.

It gives an app a durable, synced **loom**: an append-only set of **turns** with
parent pointers. From those turns you can materialize **threads**, discover
leaves, export/import deterministic snapshots, and create portable
**references** that work well in URLs.

The implementation is intentionally boring underneath: Automerge documents,
IndexedDB persistence, BroadcastChannel tab sync, and optional WebSocket sync.
The public API stays about looms, turns, threads, references, and indexes.
Lync also ships small **profile contracts** for data shapes that need
cross-application interoperability. A profile is not a helper layer; it is a
versioned schema target that independent writers and readers can agree on.

## Vocabulary

- A **loom** is one shared branching namespace. In Automerge, one loom is one
  document URL.
- A **turn** is one append-only content record in a loom. It has one parent or
  no parent.
- A **thread** is the ordered lineage from a top-level turn to any target turn.
  The target does not need to be a leaf.
- A **reference** is a portable address to a loom, turn, thread, or index.
- An **index** is a synced discovery document that stores loom references plus
  narrow display metadata. It does not duplicate loom contents.
- A **profile** is a named content contract for looms that multiple apps can
  read and write.

## Boundaries

Lync stores durable shared content. It does not store session state.

Keep these in your app, not in Lync snapshots or index entries:

- current focus
- preferred child or branch
- viewport state
- drafts and edit mode
- read progress
- presence and cursors

Use the three data lanes deliberately:

- **turn payload**: what the turn says, for example `{ text: string }`
- **turn meta**: what the turn is or relates to, for example role, author,
  provenance, `revises`, `references`, or `respondsTo`
- **loom meta**: mutable chrome for the loom, for example title or color

For story-like apps, the seed text should be a top-level turn:
`appendTurn(null, { text: "Once..." })`. If an app treats that seed as the
identity of the story, editing it should create a new loom. Lync keeps turns
append-only; it does not decide whether a seed revision belongs in the same loom
or should become a new loom.

## Packages

- `@lync/core`: looms, turns, threads, references, and snapshots.
- `@lync/index`: synced indexes of loom references.
- `@lync/client`: browser, Node, and test runtime clients.
- `@lync/sync-server`: a simple Automerge WebSocket sync relay.

## Text Story Profile

`@lync/core/profiles/text-story` defines the starter interoperable profile for
branching prose:

```ts
import {
  textStoryLoomMeta,
  type TextStoryLoomMeta,
  type TextStoryTurnMeta,
  type TextStoryTurnPayload,
} from "@lync/core/profiles/text-story";
```

The profile contract is intentionally small:

- loom meta has `profile: "org.lync.profile.textStory.v1"` and optional `title`
- turn payload is `{ text: string }`
- turn meta may include `role`, `revises`, and app-defined `generatedBy`
- the first top-level turn is the story opening
- child turns are continuations/branches
- if an app treats the opening as story identity, editing it should create a new
  loom

An external TypeScript program can write a Textile-readable story without
importing Textile:

```ts
import { createNodeLoomClient } from "@lync/client/node";
import {
  textStoryLoomMeta,
  type TextStoryLoomMeta,
  type TextStoryTurnMeta,
  type TextStoryTurnPayload,
} from "@lync/core/profiles/text-story";

const client = createNodeLoomClient<
  TextStoryTurnPayload,
  TextStoryLoomMeta,
  TextStoryTurnMeta
>({
  syncUrl: "wss://loompad.lol/lync",
});

const info = await client.looms.create(
  textStoryLoomMeta({ title: "Written elsewhere" }),
);
const loom = await client.looms.open(info.id);

const opening = await loom.appendTurn(
  null,
  { text: "Once..." },
  { role: "prose" },
);
const next = await loom.appendTurn(
  opening.id,
  { text: " then..." },
  { role: "prose" },
);

const url = client.references.toUrl(
  client.references.thread(info.id, next.id),
  new URL("https://loompad.lol/"),
);
```

The URL is enough for a reader to open the loom if both sides can reach the same
sync relay.

## Quick Start

```ts
import { createTestLoomClient } from "@lync/client/testing";

type TextPayload = { text: string };
type LoomMeta = { title: string };
type TurnMeta = {
  role: "prose" | "revision";
  revises?: string;
};

const client = createTestLoomClient<TextPayload, LoomMeta, TurnMeta>();

const info = await client.looms.create({ title: "Story 1" });
const loom = await client.looms.open(info.id);

const seed = await loom.appendTurn(
  null,
  { text: "Once upon a time," },
  { role: "prose" },
);

const next = await loom.appendTurn(
  seed.id,
  { text: " the bell rang." },
  { role: "prose" },
);

await loom.appendTurn(seed.id, { text: " the tower burned." }, { role: "prose" });

const thread = await loom.threadTo(next.id);
const leaves = await loom.leaves();
const snapshot = await loom.export();
```

## Node Scripts

Agents, importers, and command-line tools can write to the same kind of loom
without depending on Textile:

```ts
import { createNodeLoomClient } from "@lync/client/node";
import {
  textStoryLoomMeta,
  type TextStoryLoomMeta,
  type TextStoryTurnMeta,
  type TextStoryTurnPayload,
} from "@lync/core/profiles/text-story";

const client = createNodeLoomClient<
  TextStoryTurnPayload,
  TextStoryLoomMeta,
  TextStoryTurnMeta
>({
  storageDir: ".lync",
  syncUrl: "ws://localhost:3030/lync",
});

const info = await client.looms.create(
  textStoryLoomMeta({ title: "Imported thread" }),
);
const loom = await client.looms.open(info.id);
await loom.appendTurn(null, { text: "First imported post" });

await client.close();
```

Node clients use Automerge's native WebSocket adapter by default when sync does
not need custom headers, status callbacks, or required-mode error handling. You
can request it explicitly with:

```ts
const client = createNodeLoomClient({
  sync: {
    url: "ws://localhost:3030/lync",
    adapter: "native",
  },
});
```

Header-authenticated script clients should keep the resilient adapter:

```ts
const client = createNodeLoomClient({
  sync: {
    url: "wss://textile.quest/lync",
    auth: { type: "bearer", token: process.env.TEXTILE_API_AUTH_TOKEN! },
  },
});
```

## Sync Server

`@lync/sync-server` provides a small Automerge WebSocket relay. Its default
WebSocket path is `/lync`, and the standalone server reports that full URL:

```ts
import { createLyncServer } from "@lync/sync-server";

const server = createLyncServer({
  port: 3030,
  storageDir: ".lync-relay",
  authenticate(request) {
    return request.headers.authorization === `Bearer ${process.env.LYNC_TOKEN}`;
  },
});

console.log(server.url); // ws://127.0.0.1:3030/lync
```

`authenticate` is synchronous by design. Return `false` to reject an upgrade; if
the predicate throws, Lync rejects the upgrade instead of accepting it.

## Browser Client

Browser apps usually want looms, indexes, references, and one shared Automerge
repo. `@lync/client/browser` provides that shape:

```ts
import { createBrowserLoomClient } from "@lync/client/browser";

const client = createBrowserLoomClient<TextPayload, LoomMeta, TurnMeta>({
  browser: {
    indexedDb: { database: "my-app", store: "documents" },
    broadcastChannel: { channelName: "my-app" },
    syncPath: "/lync",
  },
});

const info = await client.looms.create({ title: "Story 1" });
const loom = await client.looms.open(info.id);
const seed = await loom.appendTurn(null, { text: "Once" });

const index = await client.indexes.create({ title: "My stories" });
await index.addLoom(client.references.loom(info.id), { title: "Story 1" });

const threadUrl = client.references.toUrl(
  client.references.thread(info.id, seed.id),
  window.location,
);

const ref = client.references.fromUrl(window.location);
if (ref) {
  const opened = await client.openReference(ref);
  if (opened.kind === "thread") {
    console.log(opened.thread);
  }
}
```

Default reference URLs use `?ref=<base64url-json>`. They intentionally do not
include slugs or title hints. Human labels belong in app UI and index metadata;
the reference itself is just the durable address.

## Browser Bundling

Automerge uses a WASM bundle. Vite consumers should include:

```ts
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
  plugins: [wasm(), topLevelAwait()],
});
```

Packages expose subpaths so apps can import only the surface they need:

```ts
import { createNodeLoomClient } from "@lync/client/node";
import { createAutomergeLooms } from "@lync/core/automerge";
import { textStoryLoomMeta } from "@lync/core/profiles/text-story";
import type { Loom, Turn } from "@lync/core/types";
```

The normal application path is `@lync/client/*`. Lower-level core and index
adapter subpaths exist for custom runtimes and focused tests.

## Vendoring Into Apps

Until the packages are published, vendoring the workspace is a practical
integration path. Keep it mechanical:

- mirror this repo into the app under a clear directory such as
  `vendor/lync`
- exclude `.git`, `node_modules`, build output, and test-only files if the host
  runner would pick them up
- apply only app-specific import-path shims in the vendored copy
- fold real library fixes back into this repo first, then re-vendor

That keeps Lync as the source of truth while still letting apps test against
the exact library code they ship.

## Development

```bash
pnpm install
pnpm test
pnpm build
pnpm verify
```

`pnpm verify` runs tests, builds packages, and typechecks emitted package
surfaces.

## Status

This repo is currently a v0.2 breaking cutover. The public model is
`loom/turn/thread/reference/index`; the Automerge document schema still uses
plain internal fields such as `root`, `nodes`, `children`, and `parentId`.
