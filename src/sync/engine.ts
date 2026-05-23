import type { PaprikaClient } from '../paprika/client.js';
import type { Connector, SyncedItem, SyncSummary } from '../types/connector.js';
import type { PaprikaGroceryItem } from '../types/paprika.js';
import type { Logger } from '../logger.js';
import type { Item, ItemSnapshot } from '../types/item.js';
import { hashFromItem } from '../connectors/notion/transform.js';
import type { HashableItem } from './hash.js';
import { createItemStateFacade, JsonStorageProvider, type ItemStateFacade } from './state.js';

interface SyncEngineConfig {
  readonly includePurchased: boolean;
  readonly dryRun: boolean;
  readonly stateFile: string;
  readonly listStoreMap: Record<string, string>;
  readonly bidirectionalMetadata: boolean;
}

type SyncWinner = 'paprika' | 'connector';

interface ReconcileResult {
  readonly snapshot: ItemSnapshot;
  readonly winner: SyncWinner | null;
}

function changedAt(previous: string | undefined, changed: boolean, fallback: string): string {
  return !changed && previous !== undefined ? previous : fallback;
}

function pickWinner(
  previous: Item | undefined,
  paprikaChanged: boolean,
  connectorChanged: boolean,
  paprikaChangedAt: string,
  connectorChangedAt: string,
): SyncWinner | null {
  if (previous === undefined) return 'connector';
  if (paprikaChanged && connectorChanged) {
    return Date.parse(connectorChangedAt) > Date.parse(paprikaChangedAt)
      ? 'connector'
      : 'paprika';
  }
  if (connectorChanged) return 'connector';
  if (paprikaChanged) return 'paprika';
  return null;
}

function reconcileHashes(
  previous: Item | undefined,
  paprikaHash: string,
  connectorHash: string,
  connectorUpdatedAt: string | null,
  observedAt: string,
): ReconcileResult {
  const paprikaChanged = previous === undefined || previous.paprika.hash !== paprikaHash;
  const connectorChanged = previous === undefined || previous.connector.hash !== connectorHash;
  const paprikaChangedAt = changedAt(
    previous?.paprika.changedAt,
    paprikaChanged,
    observedAt,
  );
  const connectorChangedAt = changedAt(
    previous?.connector.changedAt,
    connectorChanged,
    connectorUpdatedAt ?? observedAt,
  );
  const snapshot: ItemSnapshot = {
    paprika: { hash: paprikaHash, changedAt: paprikaChangedAt },
    connector: { hash: connectorHash, changedAt: connectorChangedAt },
  };

  if (paprikaHash === connectorHash) return { snapshot, winner: null };
  return {
    snapshot,
    winner: pickWinner(
      previous,
      paprikaChanged,
      connectorChanged,
      paprikaChangedAt,
      connectorChangedAt,
    ),
  };
}

function mergeConnectorContent(
  item: PaprikaGroceryItem,
  content: HashableItem,
  listUid: string,
): PaprikaGroceryItem {
  return {
    ...item,
    name: content.name,
    quantity: content.quantity,
    aisle: content.aisle,
    recipe: content.recipe,
    purchased: content.purchased,
    list_uid: listUid,
  };
}

export class SyncEngine {
  constructor(
    private readonly paprika: PaprikaClient,
    private readonly connectors: readonly Connector[],
    private readonly config: SyncEngineConfig,
    private readonly logger: Logger,
  ) {}

  async runCycle(): Promise<SyncSummary> {
    const state = createItemStateFacade(new JsonStorageProvider(this.config.stateFile));
    await state.initialize();

    const lists = await this.paprika.getLists();
    const listMap = new Map(lists.map((l) => [l.uid, l.name] as const));

    const allItems = await this.paprika.getItems();
    // Purchased items are still needed so Notion can unpurchase them.
    const allPaprikaMap = new Map(allItems.map((item) => [item.uid, item] as const));

    const items = this.config.includePurchased
      ? allItems
      : allItems.filter((item) => !item.purchased);

    const paprikaMap = new Map(items.map((item) => [item.uid, item] as const));

    const totals: SyncSummary = { created: 0, updated: 0, purchased: 0, unpurchased: 0, skipped: 0 };

    await Promise.all(
      this.connectors.map(async (connector) => {
        const summary = await this.runConnectorCycle(
          connector,
          paprikaMap,
          allPaprikaMap,
          listMap,
          state,
        );
        totals.created += summary.created;
        totals.updated += summary.updated;
        totals.purchased += summary.purchased;
        totals.unpurchased += summary.unpurchased;
        totals.skipped += summary.skipped;
      }),
    );

    if (!this.config.dryRun) await state.flush();

    return totals;
  }

  private async runConnectorCycle(
    connector: Connector,
    paprikaMap: ReadonlyMap<string, PaprikaGroceryItem>,
    allPaprikaMap: ReadonlyMap<string, PaprikaGroceryItem>,
    listMap: ReadonlyMap<string, string>,
    state: ItemStateFacade,
  ): Promise<SyncSummary> {
    const summary: SyncSummary = { created: 0, updated: 0, purchased: 0, unpurchased: 0, skipped: 0 };

    const syncedItems = await connector.queryAll();
    const syncedMap = new Map(syncedItems.map((s) => [s.paprikaUid, s] as const));

    for (const synced of syncedItems) {
      const paprikaItem = allPaprikaMap.get(synced.paprikaUid);
      if (paprikaItem === undefined) continue;

      await this.reconcileExistingItem(
        connector,
        synced,
        paprikaItem,
        listMap,
        state,
        summary,
      );
    }

    // ── Create missing connector records for active Paprika items ──
    for (const [uid, item] of paprikaMap) {
      const listName = listMap.get(item.list_uid) ?? 'Unknown';
      const storeName = this.config.listStoreMap[listName] ?? listName;
      const effectiveStoreName = await connector.resolveStoreName(storeName);
      const currentHash = hashFromItem(item, effectiveStoreName);
      const synced = syncedMap.get(uid);

      if (synced === undefined) {
        this.logger.info(`[${connector.name}] CREATE  ${item.name} → ${effectiveStoreName}`);
        if (!this.config.dryRun) await connector.create(item, storeName);
        const changedAt = new Date().toISOString();
        await state.upsertItem({
          connectorName: connector.name,
          paprikaUid: uid,
          name: item.name,
          snapshot: {
            paprika: { hash: currentHash, changedAt },
            connector: { hash: currentHash, changedAt },
          },
          occurredAt: changedAt,
          isCompleted: item.purchased,
        });
        summary.created++;
      }
    }

    return summary;
  }

  private async reconcileExistingItem(
    connector: Connector,
    synced: SyncedItem,
    item: PaprikaGroceryItem,
    listMap: ReadonlyMap<string, string>,
    state: ItemStateFacade,
    summary: SyncSummary,
  ): Promise<void> {
    const listName = listMap.get(item.list_uid) ?? 'Unknown';
    const storeName = this.config.listStoreMap[listName] ?? listName;
    const effectiveStoreName = await connector.resolveStoreName(storeName);
    const paprikaHash = hashFromItem(item, effectiveStoreName);
    const previous = await state.getItem(connector.name, item.uid);
    const observedAt = new Date().toISOString();
    const result = reconcileHashes(
      previous,
      paprikaHash,
      synced.hash,
      synced.updatedAt,
      observedAt,
    );

    if (result.winner === null) {
      await state.upsertItem({
        connectorName: connector.name,
        paprikaUid: item.uid,
        name: item.name,
        snapshot: result.snapshot,
        occurredAt: observedAt,
        isCompleted: item.purchased,
      });
      summary.skipped++;
      return;
    }

    if (result.winner === 'paprika') {
      this.logger.info(`[${connector.name}] UPDATE  ${item.name} → ${effectiveStoreName}`);
      if (!this.config.dryRun) await connector.update(synced.connectorId, item, storeName);
      await state.upsertItem({
        connectorName: connector.name,
        paprikaUid: item.uid,
        name: item.name,
        snapshot: {
          paprika: result.snapshot.paprika,
          connector: { hash: paprikaHash, changedAt: result.snapshot.paprika.changedAt },
        },
        occurredAt: result.snapshot.paprika.changedAt,
        isCompleted: item.purchased,
      });
      summary.updated++;
      return;
    }

    if (!this.config.bidirectionalMetadata) {
      const purchasedChanged = synced.content.purchased !== item.purchased;
      if (!purchasedChanged) {
        // Metadata-only change from connector — accept divergence, no Paprika update.
        await state.upsertItem({
          connectorName: connector.name,
          paprikaUid: item.uid,
          name: item.name,
          snapshot: result.snapshot,
          occurredAt: observedAt,
          isCompleted: item.purchased,
        });
        summary.skipped++;
        return;
      }
      // Only purchased changed — sync just that field to Paprika.
      const purchasedItem = { ...item, purchased: synced.content.purchased };
      const action = purchasedItem.purchased ? 'PURCHASE' : 'UNPURCHASE';
      this.logger.info(`[${connector.name}] ${action.padEnd(10)} Paprika ← ${synced.content.name}`);
      if (!this.config.dryRun) await this.paprika.updateItem(purchasedItem);
      const updatedPaprikaHash = hashFromItem(purchasedItem, effectiveStoreName);
      await state.upsertItem({
        connectorName: connector.name,
        paprikaUid: item.uid,
        name: item.name,
        snapshot: {
          paprika: { hash: updatedPaprikaHash, changedAt: result.snapshot.connector.changedAt },
          connector: result.snapshot.connector,
        },
        occurredAt: result.snapshot.connector.changedAt,
        isCompleted: purchasedItem.purchased,
      });
      if (action === 'PURCHASE') summary.purchased++;
      else summary.unpurchased++;
      return;
    }

    const updatedListUid =
      (await this.findListUidForConnectorStore(connector, listMap, synced.content.listName)) ??
      item.list_uid;
    const updatedItem = mergeConnectorContent(item, synced.content, updatedListUid);
    const updatedListName = listMap.get(updatedItem.list_uid) ?? listName;
    const updatedStoreName = this.config.listStoreMap[updatedListName] ?? updatedListName;
    const updatedEffectiveStoreName = await connector.resolveStoreName(updatedStoreName);
    const updatedPaprikaHash = hashFromItem(updatedItem, updatedEffectiveStoreName);
    const action = updatedItem.purchased && !item.purchased
      ? 'PURCHASE'
      : !updatedItem.purchased && item.purchased
        ? 'UNPURCHASE'
        : 'UPDATE';

    this.logger.info(`[${connector.name}] ${action.padEnd(10)} Paprika ← ${synced.content.name}`);
    if (!this.config.dryRun) await this.paprika.updateItem(updatedItem);
    await state.upsertItem({
      connectorName: connector.name,
      paprikaUid: item.uid,
      name: updatedItem.name,
      snapshot: {
        paprika: { hash: updatedPaprikaHash, changedAt: result.snapshot.connector.changedAt },
        connector: result.snapshot.connector,
      },
      occurredAt: result.snapshot.connector.changedAt,
      isCompleted: updatedItem.purchased,
    });

    if (action === 'PURCHASE') summary.purchased++;
    else if (action === 'UNPURCHASE') summary.unpurchased++;
    else summary.updated++;
  }

  private async findListUidForConnectorStore(
    connector: Connector,
    listMap: ReadonlyMap<string, string>,
    connectorStoreName: string,
  ): Promise<string | null> {
    for (const [uid, listName] of listMap) {
      const requestedStoreName = this.config.listStoreMap[listName] ?? listName;
      const effectiveStoreName = await connector.resolveStoreName(requestedStoreName);
      if (effectiveStoreName === connectorStoreName) return uid;
    }
    return null;
  }
}
