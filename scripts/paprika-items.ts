/**
 * Print all Paprika grocery items, with the list name resolved.
 * Usage:
 *   npm run script:paprika:items
 *   npm run script:paprika:items -- --include-purchased
 */
import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { Logger } from '../src/logger.js';
import { PaprikaClient } from '../src/paprika/client.js';

const includePurchased = process.argv.includes('--include-purchased');

const config = loadConfig();
const logger = new Logger(config.logLevel);
const client = new PaprikaClient(config.paprika.email, config.paprika.password, logger);

const [lists, allItems] = await Promise.all([client.getLists(), client.getItems()]);

const listMap = new Map(lists.map((l) => [l.uid, l.name] as const));

const items = includePurchased ? allItems : allItems.filter((i) => !i.purchased);

console.log(
  `\nGrocery items (${items.length} of ${allItems.length} total` +
    (includePurchased ? '' : ', purchased excluded') +
    '):\n',
);

console.table(
  items
    .sort((a, b) => a.order_flag - b.order_flag)
    .map((i) => ({
      name: i.name,
      qty: i.quantity || '—',
      aisle: i.aisle || '—',
      list: listMap.get(i.list_uid) ?? i.list_uid,
      recipe: i.recipe ?? '—',
      purchased: i.purchased,
      uid: i.uid,
    })),
);
