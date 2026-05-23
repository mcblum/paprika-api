/**
 * Smoke test for Notion write operations.
 * Creates one dummy page, prints the result, then immediately archives it.
 * Safe by default — add --write to actually hit the Notion API.
 *
 * Usage:
 *   npm run script:notion:test-write             # dry run (shows what would be sent)
 *   npm run script:notion:test-write -- --write  # actually creates + deletes a page
 */
import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { Logger } from '../src/logger.js';
import { NotionConnector } from '../src/connectors/notion/client.js';
import { toNotionProperties } from '../src/connectors/notion/transform.js';
import type { PaprikaGroceryItem } from '../src/types/paprika.js';

const write = process.argv.includes('--write');

const dummyItem: PaprikaGroceryItem = {
  uid: 'test-script-uid-0000',
  name: '[TEST] Notion Write Smoke Test',
  ingredient: '[TEST] Notion Write Smoke Test',
  quantity: '1',
  aisle: 'Test Aisle',
  aisle_uid: 'test-aisle-uid',
  list_uid: 'test-list-uid',
  recipe: 'Test Recipe',
  recipe_uid: 'test-recipe-uid',
  instruction: '',
  purchased: false,
  separate: false,
  order_flag: 0,
};

const dummyListName = 'Test List';

const config = loadConfig();

console.log('\nProperties that would be written to Notion:\n');
console.log(
  JSON.stringify(toNotionProperties(dummyItem, null, config.notion.titleProperty), null, 2),
);

if (!write) {
  console.log('\n(Dry run — pass --write to actually create and delete a page)');
  process.exit(0);
}

const logger = new Logger(config.logLevel);
const connector = new NotionConnector(config.notion, logger);

console.log('\nCreating test page...');
await connector.create(dummyItem, dummyListName);

const items = await connector.queryAll();
const created = items.find((i) => i.paprikaUid === dummyItem.uid);

if (created === undefined) {
  console.error('✗  Page was not found after creation — check Notion DB config.');
  process.exit(1);
}

console.log(`✓  Created page: ${created.connectorId}`);
console.log('Archiving test page...');
await connector.delete(created.connectorId);
console.log('✓  Test page archived. Notion write smoke test passed.');
