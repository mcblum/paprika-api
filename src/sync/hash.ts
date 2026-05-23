import { createHash } from 'node:crypto';

export interface HashableItem {
  readonly name: string;
  readonly quantity: string;
  readonly aisle: string;
  readonly recipe: string | null;
  readonly purchased: boolean;
  readonly listName: string;
}

/**
 * Connectors call this in queryAll() when rebuilding hashes from stored data.
 * Normalize falsy strings to null so empty-string and null round-trip identically.
 */
export function computeHash(item: HashableItem): string {
  const normalized = {
    name: item.name,
    quantity: item.quantity || null,
    aisle: item.aisle || null,
    recipe: item.recipe || null,
    purchased: item.purchased,
    listName: item.listName,
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}
