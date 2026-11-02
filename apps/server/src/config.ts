import { isAbsolute, normalize } from 'node:path';
import { AppError } from './errors.js';

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export interface Config {
  host: '127.0.0.1' | '::1';
  port: number;
  dataDir: string;
  logLevel: typeof LOG_LEVELS[number];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const host = env.AI_NEWS_HUB_HOST ?? '127.0.0.1';
  const portText = env.AI_NEWS_HUB_PORT ?? '3000';
  const dataDir = env.AI_NEWS_HUB_DATA_DIR ?? '/var/lib/ai-news-hub';
  const logLevel = env.AI_NEWS_HUB_LOG_LEVEL ?? 'info';
  if ((host !== '127.0.0.1' && host !== '::1') || !/^\d+$/.test(portText)
    || Number(portText) < 1 || Number(portText) > 65535 || !isAbsolute(dataDir)
    || !LOG_LEVELS.includes(logLevel as Config['logLevel'])) {
    throw new AppError('invalid_config', 'Check AI_NEWS_HUB_HOST/PORT/DATA_DIR/LOG_LEVEL');
  }
  return { host, port: Number(portText), dataDir: normalize(dataDir), logLevel: logLevel as Config['logLevel'] };
}
