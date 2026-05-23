import { Client, isFullPage } from '@notionhq/client';
import type { PaprikaGroceryItem } from '../../types/paprika.js';
import type { Connector, SyncedItem } from '../../types/connector.js';
import type { NotionConfig } from '../../types/config.js';
import type { Logger } from '../../logger.js';
import {
  toNotionProperties,
  hashFromPage,
  hashableFromPage,
  extractRichText,
  extractTitle,
  extractRelationPageId,
  extractStatus,
} from './transform.js';

export class NotionConnector implements Connector {
  readonly name = 'notion';

  private readonly client: Client;
  private readonly databaseId: string;
  private readonly storesDbId: string;
  private readonly defaultStore: string;
  private readonly titleProperty: string;

  /** storeName → Notion page ID */
  private storeNameToId: Map<string, string> | null = null;
  /** Notion page ID → storeName (inverse of storeNameToId) */
  private storeIdToName: Map<string, string> | null = null;

  constructor(config: NotionConfig, private readonly logger: Logger) {
    this.client = new Client({ auth: config.token });
    this.databaseId = config.databaseId;
    this.storesDbId = config.storesDbId;
    this.defaultStore = config.defaultStore;
    this.titleProperty = config.titleProperty;
  }

  // ── Store map ────────────────────────────────────────────────────────────────

  private async ensureStoreMap(): Promise<void> {
    if (this.storeNameToId !== null) return;

    const nameToId = new Map<string, string>();
    let cursor: string | undefined = undefined;

    do {
      const response = await this.client.databases.query({
        database_id: this.storesDbId,
        ...(cursor !== undefined ? { start_cursor: cursor } : {}),
      });

      for (const page of response.results) {
        if (!isFullPage(page)) continue;
        const name = extractTitle(page.properties['Name']);
        if (name) nameToId.set(name, page.id);
      }

      cursor =
        response.has_more && response.next_cursor !== null
          ? response.next_cursor
          : undefined;
    } while (cursor !== undefined);

    this.storeNameToId = nameToId;
    this.storeIdToName = new Map(
      Array.from(nameToId.entries()).map(([name, id]) => [id, name] as const),
    );

    this.logger.debug(`[notion] Loaded ${nameToId.size} store(s) from Stores database`);
  }

  private async resolveStorePageId(storeName: string): Promise<string | null> {
    await this.ensureStoreMap();

    const id = this.storeNameToId?.get(storeName);
    if (id !== undefined) return id;

    // Fall back to the configured default store.
    const defaultId = this.storeNameToId?.get(this.defaultStore);
    if (defaultId !== undefined) {
      this.logger.debug(
        `[notion] Store "${storeName}" not found — falling back to "${this.defaultStore}"`,
      );
      return defaultId;
    }

    this.logger.warn(
      `[notion] Store "${storeName}" not found and default store "${this.defaultStore}" ` +
        `not found either — relation will be empty`,
    );
    return null;
  }

  private lookupStoreNameById(pageId: string): string | null {
    return this.storeIdToName?.get(pageId) ?? null;
  }

  async resolveStoreName(requested: string): Promise<string> {
    await this.ensureStoreMap();
    if (this.storeNameToId?.has(requested)) return requested;
    if (this.storeNameToId?.has(this.defaultStore)) return this.defaultStore;
    return '';
  }

  // ── Connector interface ──────────────────────────────────────────────────────

  async queryAll(): Promise<SyncedItem[]> {
    await this.ensureStoreMap();

    const items: SyncedItem[] = [];
    let cursor: string | undefined = undefined;

    do {
      const response = await this.client.databases.query({
        database_id: this.databaseId,
        ...(cursor !== undefined ? { start_cursor: cursor } : {}),
      });

      for (const page of response.results) {
        if (!isFullPage(page)) continue;

        const paprikaUid = extractRichText(page.properties['UID']);
        if (!paprikaUid) continue;

        const storePageId = extractRelationPageId(page.properties['Store']);
        const storeName =
          storePageId !== null ? (this.lookupStoreNameById(storePageId) ?? '') : '';

        items.push({
          connectorId: page.id,
          paprikaUid,
          hash: hashFromPage(page, storeName, this.titleProperty),
          content: hashableFromPage(page, storeName, this.titleProperty),
          updatedAt: page.last_edited_time,
        });
      }

      cursor =
        response.has_more && response.next_cursor !== null
          ? response.next_cursor
          : undefined;
    } while (cursor !== undefined);

    this.logger.debug(`[notion] queryAll returned ${items.length} pages`);
    return items;
  }

  async create(item: PaprikaGroceryItem, storeName: string): Promise<void> {
    const storePageId = await this.resolveStorePageId(storeName);
    await this.client.pages.create({
      parent: { database_id: this.databaseId },
      properties: toNotionProperties(item, storePageId, this.titleProperty),
    });
  }

  async update(
    connectorId: string,
    item: PaprikaGroceryItem,
    storeName: string,
  ): Promise<void> {
    const storePageId = await this.resolveStorePageId(storeName);
    await this.client.pages.update({
      page_id: connectorId,
      properties: toNotionProperties(item, storePageId, this.titleProperty),
    });
  }

  async delete(connectorId: string): Promise<void> {
    await this.client.pages.update({
      page_id: connectorId,
      archived: true,
    });
  }
}
