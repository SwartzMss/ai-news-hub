import Fastify, { LogController } from 'fastify';
import type { HealthResponse, ErrorResponse } from '../../../packages/shared/src/index.js';
import type { Config } from './config.js';
import { openDatabase } from './db/database.js';
import { migrations } from './db/migrations.js';

export function buildServer(config: Config) {
  const db = openDatabase(config.dataDir);
  const app = Fastify({
    logger: {
      level: config.logLevel,
      serializers: {
        // Log no headers, body, query string or arbitrary Error message/stack.
        req: (req: { method?: string }) => ({ method: req.method }),
        err: () => ({ type: 'Error', message: 'redacted', stack: '' }),
      },
    },
    logController: new LogController({ disableRequestLogging: true }),
    requestIdHeader: false,
    bodyLimit: 64 * 1024,
    requestTimeout: 10000,
    forceCloseConnections: true,
  });
  app.addHook('onClose', async () => { db.close(); });
  app.addHook('onResponse', async (request, reply) => {
    request.log.info({ statusCode: reply.statusCode, method: request.method, route: request.routeOptions.url }, 'request_completed');
  });
  app.setErrorHandler((error, request, reply) => {
    const errorStatus = error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
    const badRequest = errorStatus >= 400 && errorStatus < 500;
    const status = badRequest ? errorStatus : 500;
    const body: ErrorResponse = { error: {
      code: badRequest ? 'bad_request' : 'internal_error',
      message: badRequest ? 'Invalid request' : 'Internal server error', requestId: request.id,
    } };
    request.log.error({ code: body.error.code, statusCode: status }, 'request_failed');
    void reply.code(status).send(body);
  });
  app.setNotFoundHandler((request, reply) => {
    const body: ErrorResponse = { error: { code: 'not_found', message: 'Route not found', requestId: request.id } };
    void reply.code(404).send(body);
  });
  app.get('/health', async (_request, reply): Promise<HealthResponse | ErrorResponse> => {
    reply.header('cache-control', 'no-store');
    try {
      const row = db.prepare('SELECT max(version) version FROM schema_migrations').get();
      if (row?.version !== migrations.at(-1)?.version) throw new Error('schema_unavailable');
      return { status: 'ok', database: 'ok' };
    } catch {
      reply.code(503);
      return { error: { code: 'database_unavailable', message: 'Database unavailable', requestId: _request.id } };
    }
  });
  return app;
}
