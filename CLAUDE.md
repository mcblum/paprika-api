# paprika-api — codebase guide

This file is intended for LLMs (and humans) working on the codebase. It covers architecture, conventions, and a step-by-step guide to adding a new connector.

## Architecture

```
src/
├── index.ts                      # Entry point — polling daemon
├── config.ts                     # Zod env schema → AppConfig
├── logger.ts                     # Simple levelled logger
├── paprika/
│   └── client.ts                 # Paprika cloud API client (read + purchase)
├── sync/
│   ├── engine.ts                 # Orchestrates one sync cycle across all connectors
│   ├── hash.ts                   # SHA-256 content hash shared by all connectors
│   └── state.ts                  # ItemStateFacade + current JSON-backed store
├── connectors/
│   └── notion/
│       ├── client.ts             # NotionConnector implements Connector
│       └── transform.ts          # Read/write property helpers + hash adapters
└── types/
    ├── config.ts                 # AppConfig, NotionConfig, SyncConfig, etc.
    ├── connector.ts              # Connector interface + SyncedItem + SyncSummary
    ├── item.ts                   # Persisted Item contract and schemas
    ├── storage.ts                # StorageProvider CRUD contract
    └── paprika.ts                # Zod schemas for all Paprika API shapes
```

### Data flow (one sync cycle)

1. `SyncEngine.runCycle()` fetches lists and items from Paprika.
2. Load `SYNC_STATE_FILE` through `ItemStateFacade`, which hides the current JSON backing store from the sync engine.
3. For each connector, `runConnectorCycle()` is called:
   a. Existing items are compared against the last-seen state. If only one side changed, that side wins. If both sides changed, the later known change wins.
   b. Notion supplies `last_edited_time`; Paprika has no item timestamps, so Paprika changes use the time the daemon observes a new Paprika hash.
   c. Missing connector records are created for active Paprika items.
4. Results are logged as a summary and the updated item state is written back when not in dry-run mode.

### Item contract

Anything persisted in the sync state database is an `Item` (`src/types/item.ts`). `createdAt` is when the item record was first created, `updatedAt` is when the stored item state last changed, and `completedAt` is when the item became completed. `completedAt` is `null` for incomplete items and is cleared if the item is uncompleted. The source-specific `paprika.changedAt` and `connector.changedAt` timestamps remain the conflict-resolution inputs.

All engine access should go through `ItemStateFacade` in `src/sync/state.ts`; do not couple sync logic directly to the JSON file shape.

### StorageProvider contract

`src/types/storage.ts` defines the async CRUD contract for persisted `Item`s:

```typescript
export interface StorageProvider {
  initialize(): Promise<void>;
  flush(): Promise<void>;
  createItem(item: Item): Promise<Item>;
  getItem(connectorName: string, paprikaUid: string): Promise<Item | undefined>;
  updateItem(item: Item): Promise<Item>;
  deleteItem(connectorName: string, paprikaUid: string): Promise<void>;
}
```

The current implementation is `JsonStorageProvider` in `src/sync/state.ts`. Future Postgres or other storage implementations should satisfy `StorageProvider` and sit behind `ItemStateFacade`; the facade owns sync-specific upsert and lifecycle timestamp behavior.

### Hash contract

`src/sync/hash.ts` exports `computeHash(HashableItem)`. Both sides of the comparison must call this with identical inputs:

- **Write side** (`hashFromItem` in `transform.ts`): called with the Paprika item and the effective store name.
- **Read side** (`hashFromPage` in `transform.ts`): reconstructs the same fields from the connector's stored representation.

The "effective store name" is the name actually written to the connector after any fallback resolution — not necessarily the Paprika list name. The engine calls `connector.resolveStoreName(requested)` before hashing to ensure both sides agree.

## The Connector interface

```typescript
// src/types/connector.ts
export interface Connector {
  readonly name: string;

  /** Return all items currently stored in this connector. */
  queryAll(): Promise<SyncedItem[]>;

  /**
   * Given a requested store name, return the name that will actually be
   * written (after any fallback). Used by the engine to compute a consistent hash.
   * Connectors with no store concept should return the requested name unchanged.
   */
  resolveStoreName(requested: string): Promise<string>;

  create(item: PaprikaGroceryItem, storeName: string): Promise<void>;
  update(connectorId: string, item: PaprikaGroceryItem, storeName: string): Promise<void>;
  delete(connectorId: string): Promise<void>;
}

export interface SyncedItem {
  readonly connectorId: string;  // opaque ID used by the connector to identify the record
  readonly paprikaUid: string;   // Paprika item UID — used as the sync key
  readonly hash: string;         // SHA-256 of the item's content as stored
  readonly content: HashableItem; // normalized content represented by hash
  readonly updatedAt: string | null; // connector last-edited timestamp when available
}
```

## Adding a new connector

### 1. Create the connector class

```
src/connectors/<name>/client.ts
```

Implement the `Connector` interface. Key points:

- `queryAll()` must return a hash computed with `computeHash` (from `src/sync/hash.ts`) using the same field values that `create`/`update` write. If the hashes don't round-trip, every item will show as an update every cycle.
- `content` should be the same normalized fields used to produce `hash`, so the engine can write connector-side edits back to Paprika.
- `content.purchased` should reflect whether the user has marked the item complete in your target system.
- `updatedAt` should be the connector's last edited timestamp when available. Return `null` if the connector has no timestamp.
- `resolveStoreName(requested)` should return the name that will actually appear in the stored record. If your connector has no store concept, return `requested` unchanged.
- `delete` should archive or soft-delete — hard deletion is not required.

### 2. Add connector config (if needed)

Add a new interface to `src/types/config.ts` and extend `AppConfig`. Add the corresponding Zod fields to `src/config.ts`.

### 3. Wire it into `src/index.ts`

Add a case to `buildConnectors()`:

```typescript
case 'myconnector':
  return [new MyConnector(config.myconnector, logger)];
```

### 4. Register the connector name

Add your connector name to the `ConnectorName` union in `src/types/config.ts` and to the Zod enum in `src/config.ts`:

```typescript
// types/config.ts
export type ConnectorName = 'notion' | 'myconnector';

// config.ts
CONNECTOR: z.enum(['notion', 'myconnector']).default('notion'),
```

### 5. Add a development script (optional but recommended)

Add a script under `scripts/` to smoke-test your connector in isolation, and register it in `package.json`. See `scripts/sync-test-list.ts` as a reference.

## Coding conventions

- **No `any`**. Use `unknown` + narrowing at system boundaries.
- **Immutable patterns** — never mutate objects in place.
- **Zod for all external data** — Paprika API responses, env vars. Validate at the boundary, infer types from schemas.
- **No comments explaining what code does** — only add a comment when the *why* is non-obvious.
- TypeScript strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- ESM throughout (`"type": "module"`), Node 24+.

## Running locally

```bash
cp .env.example .env   # fill in credentials
npm install
npm run dev            # runs src/index.ts via tsx (no build step)
npm run typecheck      # tsc --noEmit for both src/ and scripts/
npm run build          # compiles to dist/ for production
```

## Paprika API notes

- Base URL: `https://www.paprikaapp.com/api/v2`
- Auth: Bearer JWT obtained via `POST /account/login/` with multipart `email` + `password`.
- Grocery items: `GET /sync/groceries/` returns a flat list across all lists. Filter by `list_uid`.
- Write/update: `POST /sync/groceries/` with a multipart `data` field containing a **gzip-compressed JSON array** of items. See `PaprikaClient.updateItem()` for the exact implementation.
- The API has no timestamps on grocery items. Paprika change detection relies on content hashing plus the local sync state file.
- The API is not officially documented — it was reverse-engineered by the community.
