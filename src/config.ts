import 'dotenv/config';
import { z } from 'zod';
import type { AppConfig } from './types/config.js';

const envSchema = z.object({
  PAPRIKA_EMAIL: z.string().email(),
  PAPRIKA_PASSWORD: z.string().min(1),
  NOTION_TOKEN: z.string().min(1),
  NOTION_DATABASE_ID: z.string().min(32),
  NOTION_STORES_DATABASE_ID: z.string().min(32),
  NOTION_DEFAULT_STORE: z.string().min(1).default('General Grocery'),
  NOTION_TITLE_PROPERTY: z.string().min(1).default('Task name'),
  SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  SYNC_STATE_FILE: z.string().min(1).default('.sync-state.json'),
  SYNC_INCLUDE_PURCHASED: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default('false'),
  DRY_RUN: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default('false'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  CONNECTOR: z.enum(['notion']).default('notion'),
  NOTION_STORE_RELATION_MAP: z
    .string()
    .default('{}')
    .transform((val): Record<string, string> => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(val);
      } catch {
        throw new Error(
          'NOTION_STORE_RELATION_MAP must be valid JSON, e.g. {"My Grocery List":"Whole Foods"}',
        );
      }
      return z.record(z.string()).parse(parsed);
    }),
});

export function loadConfig(): AppConfig {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${errors}`);
  }
  const env = result.data;
  return {
    paprika: {
      email: env.PAPRIKA_EMAIL,
      password: env.PAPRIKA_PASSWORD,
    },
    notion: {
      token: env.NOTION_TOKEN,
      databaseId: env.NOTION_DATABASE_ID,
      storesDbId: env.NOTION_STORES_DATABASE_ID,
      defaultStore: env.NOTION_DEFAULT_STORE,
      titleProperty: env.NOTION_TITLE_PROPERTY,
    },
    sync: {
      intervalMs: env.SYNC_INTERVAL_MS,
      includePurchased: env.SYNC_INCLUDE_PURCHASED,
      dryRun: env.DRY_RUN,
      stateFile: env.SYNC_STATE_FILE,
      listStoreMap: env.NOTION_STORE_RELATION_MAP,
    },
    logLevel: env.LOG_LEVEL,
    connector: env.CONNECTOR,
  };
}
