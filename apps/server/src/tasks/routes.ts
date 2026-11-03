import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { HttpError } from '../errors.js';
import type { TaskEngine } from './engine.js';
import type { DatabaseSync } from 'node:sqlite';
import { registerNewsRoutes } from '../news/routes.js';

const id = { type: 'string', minLength: 1, maxLength: 256 };
const idempotencyKey = { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,128}$' };
const integer = (minimum: number, maximum: number, defaultValue: number) => ({ type: 'integer', minimum, maximum, default: defaultValue });
const params = (name: string) => ({ type: 'object', required: [name], properties: { [name]: id }, additionalProperties: false });
type TaskParams = { taskId: string };
type RunParams = { runId: string };
const digest = (value: string) => createHash('sha256').update(value).digest();

export async function registerTaskRoutes(app: FastifyInstance, engine: TaskEngine, token?: string, newsDb?: DatabaseSync): Promise<void> {
  const expected = token ? digest(token) : undefined;
  app.addHook('onRequest', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    if (!expected) throw new HttpError(503, 'management_disabled');
    const match = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(request.headers.authorization ?? '');
    if (!match || !timingSafeEqual(digest(match[1]), expected)) {
      reply.header('www-authenticate', 'Bearer');
      throw new HttpError(401, 'unauthorized');
    }
  });
  if (newsDb) registerNewsRoutes(app, newsDb);
  app.get('/tasks', async () => ({ tasks: engine.listTasks() }));
  app.get<{ Params: TaskParams }>('/tasks/:taskId', { schema: { params: params('taskId') } }, async (request) => ({ task: engine.task(request.params.taskId) }));
  app.get<{ Params: TaskParams; Querystring: { limit: number; offset: number } }>('/tasks/:taskId/runs', {
    schema: { params: params('taskId'), querystring: {
      type: 'object', additionalProperties: false,
      properties: { limit: integer(1, 100, 20), offset: integer(0, 100000, 0) },
    } },
  }, async (request) => ({ runs: engine.listRuns(request.params.taskId, request.query.limit, request.query.offset) }));
  app.post<{ Params: TaskParams; Body: { idempotencyKey: string } }>('/tasks/:taskId/runs', {
    schema: { params: params('taskId'), body: {
      type: 'object', additionalProperties: false, required: ['idempotencyKey'], properties: { idempotencyKey },
    } },
  }, async (request, reply) => {
    const result = engine.start(request.params.taskId, request.body.idempotencyKey);
    reply.code(result.reused ? 200 : 202); return result;
  });
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
  app.post<{ Params: RunParams; Body: { idempotencyKey: string; input: string } }>('/runs/:runId/turns', {
    schema: { params: params('runId'), body: {
      type: 'object', additionalProperties: false, required: ['idempotencyKey', 'input'],
      properties: { idempotencyKey, input: { type: 'string', minLength: 1, maxLength: 8000 } },
    } },
  }, async (request, reply) => {
    const result = engine.continueRun(request.params.runId, request.body.idempotencyKey, request.body.input);
    reply.code(result.reused ? 200 : 202); return result;
  });
}
