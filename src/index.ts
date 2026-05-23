import { loadConfig } from './config.js';
import { Logger } from './logger.js';
import { PaprikaClient } from './paprika/client.js';
import { NotionConnector } from './connectors/notion/client.js';
import { SyncEngine } from './sync/engine.js';
import type { Connector } from './types/connector.js';
import type { AppConfig, ConnectorName } from './types/config.js';

function buildConnectors(config: AppConfig, logger: Logger): Connector[] {
  const connectorName: ConnectorName = config.connector;
  switch (connectorName) {
    case 'notion':
      return [new NotionConnector(config.notion, logger)];
    default: {
      // Exhaustiveness check — TypeScript will error here if ConnectorName grows
      // without a matching case being added above.
      const _unreachable: never = connectorName;
      throw new Error(`Unknown connector: ${String(_unreachable)}`);
    }
  }
}

async function tick(engine: SyncEngine, logger: Logger): Promise<void> {
  try {
    const summary = await engine.runCycle();
    logger.info(
      `Sync complete — created: ${summary.created}, updated: ${summary.updated}, ` +
        `purchased: ${summary.purchased}, unpurchased: ${summary.unpurchased}, skipped: ${summary.skipped}`,
    );
  } catch (err) {
    logger.error(`Sync cycle failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = new Logger(config.logLevel);

  if (config.sync.dryRun) {
    logger.warn('DRY RUN enabled — no writes will be made to any connector');
  }

  const paprika = new PaprikaClient(config.paprika.email, config.paprika.password, logger);
  const connectors = buildConnectors(config, logger);
  const engine = new SyncEngine(paprika, connectors, config.sync, logger);

  logger.info(
    `Starting paprika-api sync daemon ` +
      `(connector: ${config.connector}, interval: ${config.sync.intervalMs}ms)`,
  );

  // Run immediately on startup, then on interval.
  await tick(engine, logger);
  setInterval(() => void tick(engine, logger), config.sync.intervalMs);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `Fatal startup error: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
