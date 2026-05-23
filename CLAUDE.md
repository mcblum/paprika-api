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
│   └── hash.ts                   # SHA-256 content hash shared by all connectors
├── connectors/
│   └── notion/
│       ├── client.ts             # NotionConnector implements Connector
│       └── transform.ts          # Read/write property helpers + hash adapters
└── types/
    ├── config.ts                 # AppConfig, NotionConfig, SyncConfig, etc.
    ├── connector.ts              # Connector interface + SyncedItem + SyncSummary
    └── paprika.ts                # Zod schemas for all Paprika API shapes
```

### Data flow (one sync cycle)

1. `SyncEngine.runCycle()` fetches lists and items from Paprika.
2. For each connector, `runConnectorCycle()` is called:
   a. **Notion → Paprika**: any Notion item with `done = true` that is not yet purchased in Paprika is marked purchased via `PaprikaClient.purchaseItem()`. The Notion page is left as-is (a view filter handles cleanup).
   b. **Paprika → Notion**: for each Paprika item, compute `hashFromItem(item, effectiveStoreName)` and compare against the stored hash. Create, update, or skip accordingly.
3. Results are logged as a summary.

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
  readonly done: boolean;        // true if the item is marked complete in this connector
}
```

## Adding a new connector

### 1. Create the connector class

```
src/connectors/<name>/client.ts
```

Implement the `Connector` interface. Key points:

- `queryAll()` must return a hash computed with `computeHash` (from `src/sync/hash.ts`) using the same field values that `create`/`update` write. If the hashes don't round-trip, every item will show as an update every cycle.
- `done` should reflect whether the user has marked the item complete in your target system.
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
- Write (purchase): `POST /sync/groceries/` with a multipart `data` field containing a **gzip-compressed JSON array** of items. See `PaprikaClient.purchaseItem()` for the exact implementation.
- The API has no timestamps on grocery items. Change detection relies entirely on content hashing.
- The API is not officially documented — it was reverse-engineered by the community.
