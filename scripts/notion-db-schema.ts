/**
 * Print the property names and types for the grocery database.
 * Usage: npm run script:notion:schema
 */
import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { Client } from '@notionhq/client';

const config = loadConfig();
const client = new Client({ auth: config.notion.token });

const db = await client.databases.retrieve({ database_id: config.notion.databaseId });

console.log(`\nDatabase: ${
  'title' in db && Array.isArray(db.title)
    ? db.title.map((t) => ('plain_text' in t ? t.plain_text : '')).join('')
    : db.id
}\n`);

const rows = Object.entries(db.properties).map(([name, prop]) => ({
  name,
  type: prop.type,
}));

console.table(rows.sort((a, b) => a.name.localeCompare(b.name)));
