import type { LogLevel } from './types/config.js';

const LOG_LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  constructor(private readonly minLevel: LogLevel) {}

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_RANK[level] >= LOG_LEVEL_RANK[this.minLevel];
  }

  private format(level: LogLevel, message: string): string {
    const ts = new Date().toISOString();
    const tag = level.toUpperCase().padEnd(5);
    return `[${ts}] [${tag}] ${message}`;
  }

  debug(message: string): void {
    if (this.shouldLog('debug')) {
      process.stdout.write(this.format('debug', message) + '\n');
    }
  }

  info(message: string): void {
    if (this.shouldLog('info')) {
      process.stdout.write(this.format('info', message) + '\n');
    }
  }

  warn(message: string): void {
    if (this.shouldLog('warn')) {
      process.stderr.write(this.format('warn', message) + '\n');
    }
  }

  error(message: string): void {
    if (this.shouldLog('error')) {
      process.stderr.write(this.format('error', message) + '\n');
    }
  }
}
