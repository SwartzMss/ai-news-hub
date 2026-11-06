import Fastify, { LogController } from 'fastify';
import type { HealthResponse, ErrorResponse } from '../../../packages/shared/src/index.js';
import { legacyAdminToken,type Config } from './config.js';
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
import {SettingsStore} from './settings/store.js';
import {AuthStore} from './auth/store.js';
import {registerAuthRoutes} from './auth/routes.js';

export function buildServer(config: Config, options: { adapter?: AgentAdapter; onFatal?: () => void; newsFetcher?: SourceFetch; now?: () => Date; githubAdapter?: GitHubAdapter } = {}) {
  const db = openDatabase(config.dataDir);
  let release: () => void;
  try { release = acquireBackendLock(db); }
  catch (error) { db.close(); throw error; }
  const cwd = join(config.dataDir, 'work');
  const http = options.newsFetcher ? { fetcher: options.newsFetcher, close: async () => {} } : sourceHttpClient();
  let engine: TaskEngine;
  let settings:SettingsStore,authentication:AuthStore;
  try {
    settings=new SettingsStore(db,config);
    authentication=new AuthStore(db,config.dataDir,()=>legacyAdminToken(config.legacyEnv));
    const runtime=settings.runtime();
    mkdirSync(cwd, { recursive: true, mode: 0o700 });
    const workspace = lstatSync(cwd);
    if (!workspace.isDirectory() || workspace.uid !== process.getuid?.() || (workspace.mode & 0o077) !== 0) throw new AppError('unsafe_workspace_permissions');
    engine = new TaskEngine(db, {
      adapter: options.adapter ?? {execute:(input,emit)=>new StdioAdapter(settings.runtime().codex.binary).execute(input,emit)},
      concurrency: runtime.execution.concurrency, maxQueue: runtime.execution.maxQueue, timeoutMs: runtime.execution.timeoutMs,
      cwd, model: runtime.codex.model||undefined,
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
      level: settings.runtime().logLevel,
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
  const github:GitHubAdapter=options.githubAdapter??{async publish(artifact,signal){
    const target=settings.publication();if(!target)throw new AppError('publication_disabled');
    const client=new GitHubArchive(target,target.token);try{return await client.publish(artifact,signal);}finally{await client.close();}
  }};
  const publications=new PublicationService(db,settings.publication(),settings.publication()?github:undefined);
  engine.setAutomaticPublisher(async(reportId,signal)=>{
    if(signal.aborted)throw new AppError('publication_interrupted');
    if(publications.busy())throw new AppError('publication_busy');
    const inspection=publications.inspect(reportId);
    if(!inspection.configured)throw new AppError('publication_disabled');
    publications.approve(reportId,inspection.contentHash,'automatic');
    const interrupt=()=>publications.interrupt();
    signal.addEventListener('abort',interrupt,{once:true});
    try {const result=await publications.publish(reportId);if(result.status!=='succeeded')throw new AppError(result.error_code??'github_unavailable');}
    finally {signal.removeEventListener('abort',interrupt);}
  });
  engine.resetSchedules();
  const scheduleTimer=setInterval(()=>{try{if(authentication.status().initialized)engine.tick();}catch{app.log.error({code:'scheduler_failed'},'scheduler_failed');}},1000);
  scheduleTimer.unref();
  const applySettings=()=>{
    const runtime=settings.runtime(),target=settings.publication();
    engine.configure({...runtime.execution,model:runtime.codex.model||undefined});
    publications.configure(target,target?github:undefined);
    app.log.level=runtime.logLevel;
  };
  registerAdmin(app);
  app.addHook('preClose', async () => { clearInterval(scheduleTimer); await engine.close(); await publications.close(); await http.close(); });
  app.addHook('onClose', async () => { try { release(); } finally { db.close(); } });
  app.register(async scope=>{registerAuthRoutes(scope,authentication);},{prefix:'/api'});
  app.register(async (scope) => { await registerTaskRoutes(scope, engine, authentication, db, publications,settings,applySettings,options.now); }, { prefix: '/api' });
  if(!authentication.status().initialized)app.log.info({event:'admin_setup_required'},'admin_setup_required');
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
