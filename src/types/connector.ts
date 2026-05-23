import type { PaprikaGroceryItem } from './paprika.js';
import type { HashableItem } from '../sync/hash.js';

export interface SyncedItem {
  readonly connectorId: string;
  readonly paprikaUid: string;
  readonly hash: string;
  readonly content: HashableItem;
  readonly updatedAt: string | null;
}

export interface SyncSummary {
  created: number;
  updated: number;
  purchased: number;
  unpurchased: number;
  skipped: number;
}

export interface Connector {
  readonly name: string;
  queryAll(): Promise<SyncedItem[]>;
  resolveStoreName(requested: string): Promise<string>;
  create(item: PaprikaGroceryItem, listName: string): Promise<void>;
  update(connectorId: string, item: PaprikaGroceryItem, listName: string): Promise<void>;
  delete(connectorId: string): Promise<void>;
}
