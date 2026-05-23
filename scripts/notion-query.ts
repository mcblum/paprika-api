/**
 * Query all pages currently synced in the Notion database.
 * Usage: npm run script:notion:query
 */
import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { Logger } from '../src/logger.js';
import { NotionConnector } from '../src/connectors/notion/client.js';

const config = loadConfig();
const logger = new Logger(config.logLevel);
const connector = new NotionConnector(config.notion, logger);

const items = await connector.queryAll();

console.log(`\nNotion DB — synced items (${items.length}):\n`);

if (items.length === 0) {
  console.log('  (empty — nothing synced yet)');
} else {
  console.table(
    items.map((i) => ({
      paprikaUid: i.paprikaUid,
      hash: i.hash.slice(0, 8) + '…',
      notionPageId: i.connectorId,
    })),
  );
}
