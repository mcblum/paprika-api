import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { ItemSchema, ItemSnapshotSchema } from '../types/item.js';
import type { Item, ItemSnapshot, UpsertItemInput } from '../types/item.js';
import type { StorageProvider } from '../types/storage.js';

const CURRENT_STATE_VERSION = 3;

const LegacySyncStateSchema = z.object({
  version: z.literal(1),
  connectors: z.record(z.record(ItemSnapshotSchema)),
});

const LegacyJsonItemSchema = ItemSchema.omit({ name: true });

const LegacyJsonItemStateSchema = z.object({
  version: z.literal(2),
  items: z.record(z.record(LegacyJsonItemSchema)),
});

const JsonItemStateSchema = z.object({
  version: z.literal(CURRENT_STATE_VERSION),
  items: z.record(z.record(ItemSchema)),
});

interface JsonItemState {
  readonly version: typeof CURRENT_STATE_VERSION;
  readonly items: Record<string, Record<string, Item>>;
}

function latestTimestamp(left: string, right: string): string {
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function earliestTimestamp(left: string, right: string): string {
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

function unknownItemName(paprikaUid: string): string {
  return `Unknown (${paprikaUid})`;
}

function upgradeLegacyState(json: z.infer<typeof LegacySyncStateSchema>): JsonItemState {
  const items: Record<string, Record<string, Item>> = {};

  for (const [connectorName, connectorItems] of Object.entries(json.connectors)) {
    items[connectorName] = {};
    for (const [paprikaUid, snapshot] of Object.entries(connectorItems)) {
      const createdAt = earliestTimestamp(
        snapshot.paprika.changedAt,
        snapshot.connector.changedAt,
      );
      const updatedAt = latestTimestamp(
        snapshot.paprika.changedAt,
        snapshot.connector.changedAt,
      );
      items[connectorName][paprikaUid] = {
        connectorName,
        paprikaUid,
        name: unknownItemName(paprikaUid),
        ...snapshot,
        createdAt,
        updatedAt,
        completedAt: null,
      };
    }
  }

  return { version: CURRENT_STATE_VERSION, items };
}

function upgradeJsonItemState(json: z.infer<typeof LegacyJsonItemStateSchema>): JsonItemState {
  const items: Record<string, Record<string, Item>> = {};

  for (const [connectorName, connectorItems] of Object.entries(json.items)) {
    items[connectorName] = {};
    for (const [paprikaUid, item] of Object.entries(connectorItems)) {
      items[connectorName][paprikaUid] = {
        ...item,
        name: unknownItemName(paprikaUid),
      };
    }
  }

  return { version: CURRENT_STATE_VERSION, items };
}

function snapshotChanged(existing: Item, snapshot: ItemSnapshot): boolean {
  return (
    existing.paprika.hash !== snapshot.paprika.hash ||
    existing.paprika.changedAt !== snapshot.paprika.changedAt ||
    existing.connector.hash !== snapshot.connector.hash ||
    existing.connector.changedAt !== snapshot.connector.changedAt
  );
}

export class JsonStorageProvider implements StorageProvider {
  private data: JsonItemState = { version: CURRENT_STATE_VERSION, items: {} };

  constructor(private readonly path: string) {}

  async initialize(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
        return;
      }
      throw err;
    }

    let json: unknown;
    try {
      json = JSON.parse(raw) as unknown;
    } catch (err) {
      throw new Error(
        `Could not parse sync state file at ${this.path}: ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }

    const parsed = JsonItemStateSchema.safeParse(json);
    if (parsed.success) {
      this.data = parsed.data;
      return;
    }

    const legacyJson = LegacyJsonItemStateSchema.safeParse(json);
    if (legacyJson.success) {
      this.data = upgradeJsonItemState(legacyJson.data);
      return;
    }

    const legacy = LegacySyncStateSchema.safeParse(json);
    if (legacy.success) {
      this.data = upgradeLegacyState(legacy.data);
      return;
    }

    throw new Error(`Invalid sync state file at ${this.path}: ${parsed.error.message}`);
  }

  async createItem(item: Item): Promise<Item> {
    const existing = await this.getItem(item.connectorName, item.paprikaUid);
    if (existing !== undefined) {
      throw new Error(
        `Item already exists: ${item.connectorName}/${item.paprikaUid}`,
      );
    }

    const connectorItems = this.data.items[item.connectorName] ?? {};
    connectorItems[item.paprikaUid] = item;
    this.data.items[item.connectorName] = connectorItems;
    return item;
  }

  async getItem(connectorName: string, paprikaUid: string): Promise<Item | undefined> {
    return this.data.items[connectorName]?.[paprikaUid];
  }

  async updateItem(item: Item): Promise<Item> {
    const existing = await this.getItem(item.connectorName, item.paprikaUid);
    if (existing === undefined) {
      throw new Error(`Item not found: ${item.connectorName}/${item.paprikaUid}`);
    }

    const connectorItems = this.data.items[item.connectorName] ?? {};
    connectorItems[item.paprikaUid] = item;
    this.data.items[item.connectorName] = connectorItems;
    return item;
  }

  async deleteItem(connectorName: string, paprikaUid: string): Promise<void> {
    delete this.data.items[connectorName]?.[paprikaUid];
  }

  async flush(): Promise<void> {
    const dir = dirname(this.path);
    if (dir !== '.') await mkdir(dir, { recursive: true });

    const tmpPath = `${this.path}.tmp`;
    await writeFile(tmpPath, JSON.stringify(this.data, null, 2) + '\n');
    await rename(tmpPath, this.path);
  }
}

export class ItemStateFacade {
  constructor(private readonly provider: StorageProvider) {}

  initialize(): Promise<void> {
    return this.provider.initialize();
  }

  flush(): Promise<void> {
    return this.provider.flush();
  }

  getItem(connectorName: string, paprikaUid: string): Promise<Item | undefined> {
    return this.provider.getItem(connectorName, paprikaUid);
  }

  async upsertItem(input: UpsertItemInput): Promise<Item> {
    const existing = await this.provider.getItem(input.connectorName, input.paprikaUid);
    const completedAt = input.isCompleted
      ? (existing?.completedAt ?? input.occurredAt)
      : null;
    const shouldTouch =
      existing === undefined ||
      existing.name !== input.name ||
      snapshotChanged(existing, input.snapshot) ||
      existing.completedAt !== completedAt;
    if (existing !== undefined && !shouldTouch) return existing;

    const item: Item = {
      connectorName: input.connectorName,
      paprikaUid: input.paprikaUid,
      name: input.name,
      ...input.snapshot,
      createdAt: existing?.createdAt ?? input.occurredAt,
      updatedAt: shouldTouch ? input.occurredAt : existing.updatedAt,
      completedAt,
    };

    return existing === undefined
      ? this.provider.createItem(item)
      : this.provider.updateItem(item);
  }

  deleteItem(connectorName: string, paprikaUid: string): Promise<void> {
    return this.provider.deleteItem(connectorName, paprikaUid);
  }
}

export function createItemStateFacade(provider: StorageProvider): ItemStateFacade {
  return new ItemStateFacade(provider);
}

export function createJsonItemStateFacade(path: string): ItemStateFacade {
  return createItemStateFacade(new JsonStorageProvider(path));
}
