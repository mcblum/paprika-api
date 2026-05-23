/**
 * Verify Paprika credentials and confirm authentication succeeds.
 * Usage: npm run script:paprika:auth
 */
import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { Logger } from '../src/logger.js';
import { PaprikaClient } from '../src/paprika/client.js';

const config = loadConfig();
const logger = new Logger(config.logLevel);
const client = new PaprikaClient(config.paprika.email, config.paprika.password, logger);

console.log(`Authenticating as ${config.paprika.email}...`);

// getLists() is the lightest authenticated call — triggers auth internally.
const lists = await client.getLists();

console.log(`✓  Auth succeeded. Found ${lists.length} grocery list(s).`);
