/**
 * Test script: mark a single Paprika grocery item as purchased.
 * Usage: npm run script:paprika:mark-purchased -- <item-uid>
 *
 * Example:
 *   npm run script:paprika:mark-purchased -- 839A9C95-767D-4E1A-A1DC-916B71B86AAB
 */
import 'dotenv/config';
import { gzipSync } from 'node:zlib';
import { loadConfig } from '../src/config.js';
import { Logger } from '../src/logger.js';
import { PaprikaClient } from '../src/paprika/client.js';

const itemUid = process.argv[2];
if (!itemUid) {
  process.stderr.write('Usage: paprika-mark-purchased <item-uid>\n');
  process.exit(1);
}

const config = loadConfig();
const logger = new Logger(config.logLevel);
const paprika = new PaprikaClient(config.paprika.email, config.paprika.password, logger);

const allItems = await paprika.getItems();
const item = allItems.find((i) => i.uid.toUpperCase() === itemUid.toUpperCase());

if (item === undefined) {
  process.stderr.write(`Item UID "${itemUid}" not found.\n`);
  process.exit(1);
}

console.log('\nFound item:');
console.log(`  name:      ${item.name}`);
console.log(`  purchased: ${item.purchased}`);
console.log(`  list_uid:  ${item.list_uid}`);

const updated = { ...item, purchased: true };
const payload = gzipSync(Buffer.from(JSON.stringify([updated]), 'utf8'));

const form = new FormData();
form.append('data', new Blob([payload]), 'file');

const token = await paprika.getToken();
const response = await fetch('https://www.paprikaapp.com/api/v2/sync/groceries/', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'User-Agent': 'Paprika Recipe Manager 3/3.3.1 (macOS)',
    'Accept-Encoding': 'gzip, deflate',
  },
  body: form,
});

const body: unknown = await response.json().catch(() => null);
console.log(`\nResponse: ${response.status} ${response.statusText}`);
console.log(JSON.stringify(body, null, 2));
