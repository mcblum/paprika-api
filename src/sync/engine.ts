import type { PaprikaClient } from '../paprika/client.js';
import type { Connector, SyncSummary } from '../types/connector.js';
import type { PaprikaGroceryItem } from '../types/paprika.js';
import type { Logger } from '../logger.js';
import { hashFromItem } from '../connectors/notion/transform.js';

interface SyncEngineConfig {
  readonly includePurchased: boolean;
  readonly dryRun: boolean;
  readonly listStoreMap: Record<string, string>;
}

export class SyncEngine {
  constructor(
    private readonly paprika: PaprikaClient,
    private readonly connectors: readonly Connector[],
    private readonly config: SyncEngineConfig,
    private readonly logger: Logger,
  ) {}

  async runCycle(): Promise<SyncSummary> {
    const lists = await this.paprika.getLists();
    const listMap = new Map(lists.map((l) => [l.uid, l.name] as const));

    const allItems = await this.paprika.getItems();
    const items = this.config.includePurchased
      ? allItems
      : allItems.filter((item) => !item.purchased);

    const paprikaMap = new Map(items.map((item) => [item.uid, item] as const));

    const totals: SyncSummary = { created: 0, updated: 0, deleted: 0, skipped: 0 };

    await Promise.all(
      this.connectors.map(async (connector) => {
        const summary = await this.runConnectorCycle(connector, paprikaMap, listMap);
        totals.created += summary.created;
        totals.updated += summary.updated;
        totals.deleted += summary.deleted;
        totals.skipped += summary.skipped;
      }),
    );

    return totals;
  }

  private async runConnectorCycle(
    connector: Connector,
    paprikaMap: ReadonlyMap<string, PaprikaGroceryItem>,
    listMap: ReadonlyMap<string, string>,
  ): Promise<SyncSummary> {
    const summary: SyncSummary = { created: 0, updated: 0, deleted: 0, skipped: 0 };

    const syncedItems = await connector.queryAll();
    const syncedMap = new Map(syncedItems.map((s) => [s.paprikaUid, s] as const));

    // ── Create / update / skip ──
    for (const [uid, item] of paprikaMap) {
      const listName = listMap.get(item.list_uid) ?? 'Unknown';
      const storeName = this.config.listStoreMap[listName] ?? listName;
      const currentHash = hashFromItem(item, storeName);
      const synced = syncedMap.get(uid);

      if (synced === undefined) {
        this.logger.info(`[${connector.name}] CREATE  ${item.name} → ${storeName}`);
        if (!this.config.dryRun) await connector.create(item, storeName);
        summary.created++;
      } else if (synced.hash !== currentHash) {
        this.logger.info(`[${connector.name}] UPDATE  ${item.name} → ${storeName}`);
        if (!this.config.dryRun) await connector.update(synced.connectorId, item, storeName);
        summary.updated++;
      } else {
        summary.skipped++;
      }
    }

    // ── Delete items removed from Paprika ──
    for (const [paprikaUid, synced] of syncedMap) {
      if (!paprikaMap.has(paprikaUid)) {
        this.logger.info(`[${connector.name}] DELETE  uid=${paprikaUid}`);
        if (!this.config.dryRun) await connector.delete(synced.connectorId);
        summary.deleted++;
      }
    }

    return summary;
  }
}
