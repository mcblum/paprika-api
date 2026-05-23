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
    // allPaprikaMap includes purchased items — needed for the unpurchase pass.
    const allPaprikaMap = new Map(allItems.map((item) => [item.uid, item] as const));

    const items = this.config.includePurchased
      ? allItems
      : allItems.filter((item) => !item.purchased);

    const paprikaMap = new Map(items.map((item) => [item.uid, item] as const));

    const totals: SyncSummary = { created: 0, updated: 0, purchased: 0, unpurchased: 0, skipped: 0 };

    await Promise.all(
      this.connectors.map(async (connector) => {
        const summary = await this.runConnectorCycle(connector, paprikaMap, allPaprikaMap, listMap);
        totals.created += summary.created;
        totals.updated += summary.updated;
        totals.purchased += summary.purchased;
        totals.unpurchased += summary.unpurchased;
        totals.skipped += summary.skipped;
      }),
    );

    return totals;
  }

  private async runConnectorCycle(
    connector: Connector,
    paprikaMap: ReadonlyMap<string, PaprikaGroceryItem>,
    allPaprikaMap: ReadonlyMap<string, PaprikaGroceryItem>,
    listMap: ReadonlyMap<string, string>,
  ): Promise<SyncSummary> {
    const summary: SyncSummary = { created: 0, updated: 0, purchased: 0, unpurchased: 0, skipped: 0 };

    const syncedItems = await connector.queryAll();
    const syncedMap = new Map(syncedItems.map((s) => [s.paprikaUid, s] as const));

    // ── Connector → Paprika: sync "done" state bidirectionally ──
    // Does NOT archive connector pages — the 24h view filter handles cleanup.
    const purchasedThisCycle = new Set<string>();
    for (const synced of syncedItems) {
      const paprikaItem = allPaprikaMap.get(synced.paprikaUid);
      if (paprikaItem === undefined) continue;

      if (synced.done && !paprikaItem.purchased) {
        this.logger.info(`[${connector.name}] PURCHASE    ${paprikaItem.name}`);
        if (!this.config.dryRun) await this.paprika.purchaseItem(paprikaItem);
        purchasedThisCycle.add(synced.paprikaUid);
        summary.purchased++;
      } else if (!synced.done && paprikaItem.purchased) {
        this.logger.info(`[${connector.name}] UNPURCHASE  ${paprikaItem.name}`);
        if (!this.config.dryRun) await this.paprika.unpurchaseItem(paprikaItem);
        summary.unpurchased++;
      }
    }

    // ── Create / update / skip ──
    for (const [uid, item] of paprikaMap) {
      if (purchasedThisCycle.has(uid)) continue;

      const listName = listMap.get(item.list_uid) ?? 'Unknown';
      const storeName = this.config.listStoreMap[listName] ?? listName;
      const effectiveStoreName = await connector.resolveStoreName(storeName);
      const currentHash = hashFromItem(item, effectiveStoreName);
      const synced = syncedMap.get(uid);

      if (synced === undefined) {
        this.logger.info(`[${connector.name}] CREATE  ${item.name} → ${effectiveStoreName}`);
        if (!this.config.dryRun) await connector.create(item, storeName);
        summary.created++;
      } else if (synced.hash !== currentHash) {
        this.logger.info(`[${connector.name}] UPDATE  ${item.name} → ${effectiveStoreName}`);
        if (!this.config.dryRun) await connector.update(synced.connectorId, item, storeName);
        summary.updated++;
      } else {
        summary.skipped++;
      }
    }

    return summary;
  }
}
