/**
 * Run a sync cycle for a single Paprika list and report the diff.
 * Safe by default (dry run). Pass --write to actually write to Notion.
 * Deletes are intentionally skipped — this is a targeted test, not a full reconcile.
 *
 * Usage:
 *   npm run script:sync:test-list -- <list-uid>
 *   npm run script:sync:test-list -- <list-uid> --write
 *
 * Example:
 *   npm run script:sync:test-list -- 810CDE6F-987F-4975-8818-621EC72D4407
 *   npm run script:sync:test-list -- 810CDE6F-987F-4975-8818-621EC72D4407 --write
 */
import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { Logger } from '../src/logger.js';
import { PaprikaClient } from '../src/paprika/client.js';
import { NotionConnector } from '../src/connectors/notion/client.js';
import { hashFromItem } from '../src/connectors/notion/transform.js';

const args = process.argv.slice(2);
const listUid = args.find((a) => !a.startsWith('--'));
const write = args.includes('--write');

if (!listUid) {
  process.stderr.write('Usage: sync-test-list <list-uid> [--write]\n');
  process.exit(1);
}

const config = loadConfig();
const logger = new Logger(config.logLevel);

// ── Fetch Paprika data ───────────────────────────────────────────────────────

const paprika = new PaprikaClient(config.paprika.email, config.paprika.password, logger);
const [lists, allItems] = await Promise.all([paprika.getLists(), paprika.getItems()]);

const targetList = lists.find((l) => l.uid.toUpperCase() === listUid.toUpperCase());
if (targetList === undefined) {
  process.stderr.write(`List UID "${listUid}" not found in Paprika.\n`);
  process.stderr.write(`Known lists:\n`);
  for (const l of lists) process.stderr.write(`  ${l.uid}  ${l.name}\n`);
  process.exit(1);
}

const storeName = config.sync.listStoreMap[targetList.name] ?? targetList.name;
const listItems = allItems.filter(
  (i) => i.list_uid === targetList.uid && (config.sync.includePurchased || !i.purchased),
);

console.log(
  `\nList:  ${targetList.name}  (uid: ${targetList.uid})` +
    `\nStore: ${storeName}` +
    `\nItems: ${listItems.length} (of ${allItems.filter((i) => i.list_uid === targetList.uid).length} total on list)` +
    `\nMode:  ${write ? 'WRITE' : 'DRY RUN'}\n`,
);

if (listItems.length === 0) {
  console.log('Nothing to sync.');
  process.exit(0);
}

// ── Fetch Notion state ───────────────────────────────────────────────────────

const connector = new NotionConnector(config.notion, logger);
const syncedItems = await connector.queryAll();
const syncedMap = new Map(syncedItems.map((s) => [s.paprikaUid, s] as const));

// ── Diff ─────────────────────────────────────────────────────────────────────

const summary = { created: 0, updated: 0, skipped: 0 };

const effectiveStoreName = await connector.resolveStoreName(storeName);

for (const item of listItems) {
  const currentHash = hashFromItem(item, effectiveStoreName);
  const synced = syncedMap.get(item.uid);

  if (synced === undefined) {
    console.log(`  CREATE   ${item.name}`);
    if (write) await connector.create(item, storeName);
    summary.created++;
  } else if (synced.hash !== currentHash) {
    console.log(`  UPDATE   ${item.name}`);
    if (write) await connector.update(synced.connectorId, item, storeName);
    summary.updated++;
  } else {
    console.log(`  skip     ${item.name}`);
    summary.skipped++;
  }
}

console.log(
  `\nResult: created ${summary.created}, updated ${summary.updated}, skipped ${summary.skipped}` +
    (!write ? '  (dry run — pass --write to apply)' : ''),
);
