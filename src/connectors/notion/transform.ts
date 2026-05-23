import { Client, isFullPage } from '@notionhq/client';
import type { PaprikaGroceryItem } from '../../types/paprika.js';
import { computeHash } from '../../sync/hash.js';
import type { HashableItem } from '../../sync/hash.js';

// Derive write-side property type from the SDK client — no internal imports needed.
type PageCreateParams = Parameters<Client['pages']['create']>[0];
export type NotionProperties = NonNullable<PageCreateParams['properties']>;

// Derive read-side property type the same way.
type FullPage = Extract<Parameters<typeof isFullPage>[0], { properties: Record<string, unknown> }>;
type PageProperty = FullPage['properties'][string];

// ── Property extractors ──────────────────────────────────────────────────────

export function extractRichText(prop: PageProperty | undefined): string {
  if (prop === undefined || prop.type !== 'rich_text') return '';
  return prop.rich_text.map((rt) => rt.plain_text).join('');
}

export function extractTitle(prop: PageProperty | undefined): string {
  if (prop === undefined || prop.type !== 'title') return '';
  return prop.title.map((t) => t.plain_text).join('');
}

export function extractRelationPageId(prop: PageProperty | undefined): string | null {
  if (prop === undefined || prop.type !== 'relation') return null;
  // The SDK's relation union includes both a page-value array and a database-schema
  // config object. Narrow to the array variant before indexing.
  if (!Array.isArray(prop.relation)) return null;
  const first = (prop.relation as Array<{ id: string }>)[0];
  return first?.id ?? null;
}

export function extractStatus(prop: PageProperty | undefined): boolean {
  if (prop === undefined || prop.type !== 'status') return false;
  if (typeof prop.status !== 'object' || prop.status === null) return false;
  if (!('name' in prop.status)) return false;
  return (prop.status as { name: string }).name === 'Done';
}

// ── Write-side transform ─────────────────────────────────────────────────────

export function toNotionProperties(
  item: PaprikaGroceryItem,
  storePageId: string | null,
  titleProperty: string,
): NotionProperties {
  return {
    [titleProperty]: { title: [{ text: { content: item.name } }] },
    Store: { relation: storePageId !== null ? [{ id: storePageId }] : [] },
    Aisle: {
      rich_text: item.aisle ? [{ text: { content: item.aisle } }] : [],
    },
    Recipe: {
      rich_text: item.recipe !== null ? [{ text: { content: item.recipe } }] : [],
    },
    Quantity: {
      rich_text: item.quantity ? [{ text: { content: item.quantity } }] : [],
    },
    Status: { status: { name: item.purchased ? 'Done' : 'Not started' } },
    UID: { rich_text: [{ text: { content: item.uid } }] },
  };
}

// ── Hash helpers ─────────────────────────────────────────────────────────────

export function hashableFromItem(item: PaprikaGroceryItem, listName: string): HashableItem {
  return {
    name: item.name,
    quantity: item.quantity,
    aisle: item.aisle,
    recipe: item.recipe,
    purchased: item.purchased,
    listName,
  };
}

export function hashFromItem(item: PaprikaGroceryItem, listName: string): string {
  return computeHash(hashableFromItem(item, listName));
}

export function hashableFromPage(
  page: FullPage,
  storeName: string,
  titleProperty: string,
): HashableItem {
  const props = page.properties;
  return {
    name: extractTitle(props[titleProperty]),
    quantity: extractRichText(props['Quantity']),
    aisle: extractRichText(props['Aisle']),
    recipe: extractRichText(props['Recipe']) || null,
    purchased: extractStatus(props['Status']),
    listName: storeName,
  };
}

// storeName must be resolved by the caller (reverse-lookup from the relation page ID).
// titleProperty must match the configured NOTION_TITLE_PROPERTY env var.
export function hashFromPage(page: FullPage, storeName: string, titleProperty: string): string {
  return computeHash(hashableFromPage(page, storeName, titleProperty));
}
