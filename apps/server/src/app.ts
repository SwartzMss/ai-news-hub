import Fastify, { LogController } from 'fastify';
import type { HealthResponse, ErrorResponse } from '../../../packages/shared/src/index.js';
import type { Config } from './config.js';
import { openDatabase } from './db/database.js';
import { migrations } from './db/migrations.js';
import { lstatSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { AppError, HttpError } from './errors.js';
import { StdioAdapter } from './agent/stdio-adapter.js';
import type { AgentAdapter } from './agent/types.js';
import { TaskEngine } from './tasks/engine.js';
import { acquireBackendLock } from './tasks/lock.js';
import { registerTaskRoutes } from './tasks/routes.js';
import { NewsWorkflow } from './news/workflow.js';
import { sourceHttpClient, type SourceFetch } from './news/sources.js';
import { registerAdmin } from './admin.js';
import { PublicationService, type GitHubAdapter } from './publish/service.js';
import { GitHubArchive } from './publish/github.js';
import { NEWS_TASK_ID } from './news/source.js';

export function buildServer(config: Config, options: { adapter?: AgentAdapter; onFatal?: () => void; newsFetcher?: SourceFetch; now?: () => Date; githubAdapter?: GitHubAdapter } = {}) {
  const db = openDatabase(config.dataDir);
  let release: () => void;
  try { release = acquireBackendLock(db); }
  catch (error) { db.close(); throw error; }
  const cwd = join(config.dataDir, 'work');
  const http = options.newsFetcher ? { fetcher: options.newsFetcher, close: async () => {} } : sourceHttpClient();
  let engine: TaskEngine;
  try {
    mkdirSync(cwd, { recursive: true, mode: 0o700 });
    const workspace = lstatSync(cwd);
    if (!workspace.isDirectory() || workspace.uid !== process.getuid?.() || (workspace.mode & 0o077) !== 0) throw new AppError('unsafe_workspace_permissions');
    engine = new TaskEngine(db, {
      adapter: options.adapter ?? new StdioAdapter(config.codexBin),
      concurrency: config.concurrency, maxQueue: config.maxQueue, timeoutMs: config.runTimeoutMs,
      cwd, model: config.model,
      workflows: new Map([[NEWS_TASK_ID, new NewsWorkflow(db, http.fetcher, options.now)]]),
      onFatal: () => {
        app.log.error({ code: 'engine_unavailable' }, 'task_engine_unavailable');
        if (options.onFatal) options.onFatal();
        else void app.close().catch(() => {});
      },
    });
  } catch (error) { release(); db.close(); throw error; }
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
  const github=options.githubAdapter ?? (config.publication ? new GitHubArchive(config.publication,config.publication.token):undefined);
  const publications=new PublicationService(db,config.publication,github);
  registerAdmin(app);
  app.addHook('preClose', async () => { await engine.close(); await publications.close(); if(github instanceof GitHubArchive)await github.close(); await http.close(); });
  app.addHook('onClose', async () => { try { release(); } finally { db.close(); } });
  app.register(async (scope) => { await registerTaskRoutes(scope, engine, config.adminToken, db, publications); }, { prefix: '/api' });
  app.addHook('onResponse', async (request, reply) => {
    request.log.info({ statusCode: reply.statusCode, method: request.method, route: request.routeOptions.url }, 'request_completed');
  });
  app.setErrorHandler((error, request, reply) => {
    const errorStatus = error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
    const badRequest = errorStatus >= 400 && errorStatus < 500;
    const status = error instanceof HttpError ? error.statusCode : badRequest ? errorStatus : 500;
    const body: ErrorResponse = { error: {
      code: error instanceof HttpError ? error.code : badRequest ? 'bad_request' : 'internal_error',
      message: error instanceof HttpError ? error.code : badRequest ? 'Invalid request' : 'Internal server error', requestId: request.id,
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
      if (row?.version !== migrations.at(-1)?.version || !engine.healthy()) throw new Error('schema_unavailable');
      return { status: 'ok', database: 'ok' };
    } catch {
      reply.code(503);
      return { error: { code: 'database_unavailable', message: 'Database unavailable', requestId: _request.id } };
    }
  });
  return app;
}
