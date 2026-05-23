import type { Item } from './item.js';

export interface StorageProvider {
  initialize(): Promise<void>;
  flush(): Promise<void>;
  createItem(item: Item): Promise<Item>;
  getItem(connectorName: string, paprikaUid: string): Promise<Item | undefined>;
  updateItem(item: Item): Promise<Item>;
  deleteItem(connectorName: string, paprikaUid: string): Promise<void>;
}
