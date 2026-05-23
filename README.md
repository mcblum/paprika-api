# paprika-api

A daemon that syncs [Paprika Recipe Manager](https://www.paprikaapp.com/) grocery lists into external tools via pluggable connectors. Currently ships with a **Notion** connector.

## How it works

1. On startup and every `SYNC_INTERVAL_MS` milliseconds, the daemon fetches all grocery lists and items from the Paprika cloud API.
2. Each item is compared against what the connector already has, using SHA-256 content hashes and the `ItemStateFacade` over the configured `StorageProvider`.
3. New items are created, changed items are updated, unchanged items are skipped.
4. **Bidirectional:** the side that changed most recently wins. Notion changes use Notion's `last_edited_time`; Paprika changes use the time the daemon first observes the changed Paprika hash.

Because Paprika grocery items do not expose update timestamps, `SYNC_STATE_FILE` must be stored on persistent disk. Without previous state, an existing Paprika/Notion mismatch cannot be ordered exactly; the connector value is used to preserve edits made outside Paprika.

Each stored `Item` includes the grocery item `name` for readability and tracks `createdAt`, `updatedAt`, and `completedAt`. `completedAt` is nullable and is cleared if an item is uncompleted. The current provider is JSON-backed; the storage contract is async CRUD so it can be replaced with Postgres or another backend.

## Notion connector

### Grocery database schema

Your Notion grocery database needs these properties:

| Property | Type | Notes |
|---|---|---|
| _(title)_ | Title | Name of the item. Default property name: `Task name` — set `NOTION_TITLE_PROPERTY` if yours differs. |
| `UID` | Text | Paprika item UID. Used as the sync key. |
| `Store` | Relation | Relation to a separate Stores database. |
| `Aisle` | Text | |
| `Quantity` | Text | |
| `Recipe` | Text | |
| `Status` | Status | Notion status type. `Done` = purchased. |

### Stores database

A separate Notion database with a `Name` title property. Each page represents a store. The `Store` relation on the grocery database points here.

## Quick start

```bash
cp .env.example .env
# fill in .env
npm install
npm run dev
```

## Docker

```bash
docker build -t paprika-api .
docker run --env-file .env -v paprika-sync-state:/app/state -e SYNC_STATE_FILE=/app/state/sync-state.json paprika-api
```

A pre-built image is published to `ghcr.io/mcblum/paprika-api:latest` on every merge to `main`.

## Configuration

All configuration is via environment variables.

### Required

| Variable | Description |
|---|---|
| `PAPRIKA_EMAIL` | Paprika account email |
| `PAPRIKA_PASSWORD` | Paprika account password |
| `NOTION_TOKEN` | Notion integration token (`secret_...`) |
| `NOTION_DATABASE_ID` | ID of the grocery Notion database |
| `NOTION_STORES_DATABASE_ID` | ID of the Stores relation database |

### Optional

| Variable | Default | Description |
|---|---|---|
| `NOTION_TITLE_PROPERTY` | `Task name` | Name of the title property in the grocery database |
| `NOTION_DEFAULT_STORE` | `General Grocery` | Store used when a list has no mapping |
| `NOTION_STORE_RELATION_MAP` | `{}` | JSON map of Paprika list name → Notion store name |
| `SYNC_INTERVAL_MS` | `60000` | Poll interval in milliseconds |
| `SYNC_STATE_FILE` | `.sync-state.json` | Local file used by `ItemStateFacade` to track item hashes and timestamps |
| `SYNC_INCLUDE_PURCHASED` | `false` | Include already-purchased Paprika items in sync |
| `DRY_RUN` | `false` | Log what would happen without writing anything |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `CONNECTOR` | `notion` | Active connector |

### Store mapping

`NOTION_STORE_RELATION_MAP` maps Paprika list names to the store name in your Notion Stores database. Wrap in single quotes in `.env` files to avoid JSON parsing issues with inner double quotes.

```
NOTION_STORE_RELATION_MAP='{"Costco List":"Costco","My Grocery List":"Whole Foods"}'
```

If a list has no mapping and the list name itself is not found in the Stores database, the connector falls back to `NOTION_DEFAULT_STORE`.

## Development scripts

```bash
npm run script:paprika:auth                            # verify Paprika credentials
npm run script:paprika:lists                           # list all Paprika grocery lists
npm run script:paprika:items                           # list all grocery items
npm run script:paprika:mark-purchased -- <uid>         # mark a single item purchased
npm run script:notion:schema                           # print property names/types of the grocery DB
npm run script:notion:query                            # dump all Notion grocery pages
npm run script:notion:test-write                       # create + immediately archive a test page
npm run script:sync:test-list -- <list-uid>            # dry-run sync for one list
npm run script:sync:test-list -- <list-uid> --write    # live sync for one list
```

## Adding a connector

See [CLAUDE.md](./CLAUDE.md) for a full guide aimed at LLMs and developers alike.
