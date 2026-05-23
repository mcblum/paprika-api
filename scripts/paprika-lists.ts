/**
 * Print all Paprika grocery lists.
 * Usage: npm run script:paprika:lists
 */
import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { Logger } from '../src/logger.js';
import { PaprikaClient } from '../src/paprika/client.js';

const config = loadConfig();
const logger = new Logger(config.logLevel);
const client = new PaprikaClient(config.paprika.email, config.paprika.password, logger);

const lists = await client.getLists();

console.log(`\nGrocery lists (${lists.length}):\n`);
console.table(
  lists
    .sort((a, b) => a.order_flag - b.order_flag)
    .map((l) => ({
      name: l.name,
      default: l.is_default,
      uid: l.uid,
    })),
);
