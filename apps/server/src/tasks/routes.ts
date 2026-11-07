import { promptTemplates } from "./prompt-templates.js";
import type { RunListQuery } from '../../../../packages/shared/src/index.js';
import type { FastifyInstance } from 'fastify';
import { HttpError } from '../errors.js';
import type { TaskEngine } from './engine.js';
import type { DatabaseSync } from 'node:sqlite';
import { registerPublicationRoutes } from '../publish/routes.js';
import type { PublicationService } from '../publish/service.js';
import { registerNewsRoutes } from '../news/routes.js';
import type {AuthStore} from '../auth/store.js';
import {registerCredentialRoutes} from '../auth/routes.js';
import type {SettingsStore} from '../settings/store.js';
import {SETTINGS_SCHEMA} from '../settings/schema.js';

const id = { type: 'string', minLength: 1, maxLength: 256 };
const idempotencyKey = { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,128}$' };
const integer = (minimum: number, maximum: number, defaultValue: number) => ({ type: 'integer', minimum, maximum, default: defaultValue });
const params = (name: string) => ({ type: 'object', required: [name], properties: { [name]: id }, additionalProperties: false });
type TaskParams = { taskId: string };
type RunParams = { runId: string };

export async function registerTaskRoutes(app: FastifyInstance, engine: TaskEngine, auth: AuthStore, newsDb?: DatabaseSync, publications?: PublicationService, settings?: SettingsStore, applySettings?:()=>void, now:()=>Date=()=>new Date()): Promise<void> {
  app.addHook('onRequest', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    if (!auth.status().initialized) throw new HttpError(503, 'management_disabled');
    const match = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(request.headers.authorization ?? '');
    if (!match || !auth.authorize(match[1])) {
      reply.header('www-authenticate', 'Bearer');
      throw new HttpError(401, 'unauthorized');
    }
  });
  registerCredentialRoutes(app,auth);
  if(settings){
    app.get('/settings',async()=>settings.view());
    app.put<{Body:unknown}>('/settings',{schema:{body:SETTINGS_SCHEMA}},async request=>{
      if(engine.busy()||publications?.busy())throw new HttpError(409,'settings_busy');
      const result=settings.update(request.body);applySettings?.();return result;
    });
  }
  if (newsDb) registerNewsRoutes(app, newsDb);
  if (publications) registerPublicationRoutes(app,publications);
  app.get('/overview', async()=>engine.overview(now()));
  app.get('/prompt-templates', async () => ({ templates: promptTemplates() }));
  app.get('/tasks', async () => ({ tasks: engine.listTasks() }));
  app.post<{Body:unknown}>('/tasks',{bodyLimit:1024*1024},async(request,reply)=>{const task=engine.createTask(request.body);reply.code(201);return {task};});
  app.put<{Params:TaskParams;Body:unknown}>('/tasks/:taskId',{bodyLimit:1024*1024,schema:{params:params('taskId')}},async request=>({task:engine.updateTask(request.params.taskId,request.body)}));
  app.delete<{Params:TaskParams}>('/tasks/:taskId',{schema:{params:params('taskId')}},async(request,reply)=>{engine.deleteTask(request.params.taskId);reply.code(204);});
  app.post<{Params:TaskParams}>('/tasks/:taskId/stop',{schema:{params:params('taskId')}},async(request,reply)=>{engine.stopTask(request.params.taskId);reply.code(202);return {task:engine.task(request.params.taskId)};});

  app.get<{ Params: TaskParams }>('/tasks/:taskId', { schema: { params: params('taskId') } }, async (request) => ({ task: engine.task(request.params.taskId) }));
  app.get<{ Params: TaskParams; Querystring: { limit: number; offset: number } }>('/tasks/:taskId/runs', {
    schema: { params: params('taskId'), querystring: {
      type: 'object', additionalProperties: false,
      properties: { limit: integer(1, 100, 20), offset: integer(0, 100000, 0) },
    } },
  }, async (request) => ({ runs: engine.listRuns(request.params.taskId, request.query.limit, request.query.offset) }));
  app.post<{ Params: TaskParams; Body: { idempotencyKey: string; topic?: string; input?: string } }>('/tasks/:taskId/runs', {
    schema: { params: params('taskId'), body: {
      type: 'object', additionalProperties: false, required: ['idempotencyKey'], properties: { idempotencyKey, topic: { type: 'string', minLength: 1, maxLength: 200 }, input: { type: 'string', minLength: 1, maxLength: 8000 } },
    } },
  }, async (request, reply) => {
    const result = engine.start(request.params.taskId, request.body.idempotencyKey, request.body);
    reply.code(result.reused ? 200 : 202); return result;
  });
  app.get<{Querystring:RunListQuery}>('/runs',{preValidation:async request=>{if(Object.keys(request.query).some(key=>!['taskId','state','limit','offset'].includes(key)))throw new HttpError(400,'bad_request');},schema:{querystring:{type:'object',additionalProperties:false,properties:{taskId:id,state:{type:'string',enum:['all','running','pending_review','publish_failed','failed','published'],default:'all'},limit:integer(1,100,20),offset:integer(0,100000,0)}}}},async request=>engine.listAllRuns(request.query));
  app.get<{ Params: RunParams }>('/runs/:runId', { schema: { params: params('runId') } }, async (request) => engine.detail(request.params.runId));
  app.get<{ Params: RunParams; Querystring: { after: number; limit: number } }>('/runs/:runId/events', {
    schema: { params: params('runId'), querystring: {
      type: 'object', additionalProperties: false,
      properties: { after: integer(0, Number.MAX_SAFE_INTEGER, 0), limit: integer(1, 100, 100) },
    } },
  }, async (request) => ({ events: engine.events(request.params.runId, request.query.after, request.query.limit) }));
  app.post<{ Params: RunParams }>('/runs/:runId/cancel', { schema: { params: params('runId') } }, async (request, reply) => {
    reply.code(202); return { run: engine.cancel(request.params.runId) };
  });
  app.post<{ Params: RunParams; Body: { idempotencyKey: string; input: string; finalize?: boolean } }>('/runs/:runId/turns', {
    schema: { params: params('runId'), body: {
      type: 'object', additionalProperties: false, required: ['idempotencyKey', 'input'],
      properties: { idempotencyKey, input: { type: 'string', minLength: 1, maxLength: 8000 }, finalize: { type: 'boolean' } },
    } },
  }, async (request, reply) => {
    const result = engine.continueRun(request.params.runId, request.body.idempotencyKey, request.body.input, request.body.finalize);
    reply.code(result.reused ? 200 : 202); return result;
  });
}
