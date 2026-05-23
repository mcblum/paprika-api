export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type ConnectorName = 'notion';

export interface PaprikaConfig {
  readonly email: string;
  readonly password: string;
}

export interface NotionConfig {
  readonly token: string;
  readonly databaseId: string;
  /** Database ID of the Stores relation table (the DB that the Store field points at). */
  readonly storesDbId: string;
  /** Store name to use when a Paprika list has no matching entry in the Stores database. */
  readonly defaultStore: string;
  /** Name of the title property in the grocery database (e.g. "Task name"). */
  readonly titleProperty: string;
}

export interface SyncConfig {
  readonly intervalMs: number;
  readonly includePurchased: boolean;
  readonly dryRun: boolean;
  readonly stateFile: string;
  /** Maps Paprika list names to the Store label written in Notion. Falls back to the list name if unmapped. */
  readonly listStoreMap: Record<string, string>;
}

export interface AppConfig {
  readonly paprika: PaprikaConfig;
  readonly notion: NotionConfig;
  readonly sync: SyncConfig;
  readonly logLevel: LogLevel;
  readonly connector: ConnectorName;
}
