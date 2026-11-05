import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { HttpError } from '../errors.js';

const page = { type: 'object', additionalProperties: false, properties: {
  limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  offset: { type: 'integer', minimum: 0, maximum: 100000, default: 0 },
} };
type Page = { limit: number; offset: number };
const identifier = (name: string) => ({ type: 'object', additionalProperties: false, required: [name], properties: { [name]: { type: 'string', minLength: 1, maxLength: 256 } } });

// Registered inside the existing authenticated /api scope, never at the root.
export function registerNewsRoutes(app: FastifyInstance, db: DatabaseSync): void {
  app.get<{ Querystring: Page }>('/news/articles', { schema: { querystring: page } }, async (request) => ({
    articles: db.prepare('SELECT * FROM articles ORDER BY fetched_at DESC,id LIMIT ? OFFSET ?').all(request.query.limit, request.query.offset).map(row=>row.source_mode==='codex_reported'?{...row,fetched_at:null,received_at:row.fetched_at}:row),
  }));
  app.get<{ Querystring: Page }>('/news/reports', { schema: { querystring: page } }, async (request) => ({
    reports: db.prepare(`SELECT r.id,r.run_id,r.report_date,r.channel,r.version,r.title,r.status,r.created_at
      FROM reports r WHERE r.id IN (SELECT report_id FROM news_runs UNION ALL SELECT report_id FROM codex_news_runs)
      ORDER BY r.report_date DESC,r.version DESC,r.id LIMIT ? OFFSET ?`).all(request.query.limit, request.query.offset),
  }));
  app.get<{ Params: { reportId: string } }>('/news/reports/:reportId', { schema: { params: identifier('reportId') } }, async (request) => {
    const row = db.prepare('SELECT r.* FROM reports r WHERE r.id=? AND r.id IN (SELECT report_id FROM news_runs UNION ALL SELECT report_id FROM codex_news_runs)').get(request.params.reportId);
    if (!row) throw new HttpError(404, 'report_not_found');
    const { content_json, ...report } = row;
    return { report: { ...report, document: JSON.parse(String(content_json)) as unknown } };
  });
  app.get<{ Params: { runId: string } }>('/news/runs/:runId', { schema: { params: identifier('runId') } }, async (request) => {
    const row = db.prepare('SELECT * FROM codex_news_runs WHERE run_id=?').get(request.params.runId)
      ?? db.prepare('SELECT * FROM news_runs WHERE run_id=?').get(request.params.runId);
    if (!row) throw new HttpError(404, 'news_run_not_found');
    const { candidates_json, ...newsRun } = row;
    return { newsRun: { ...newsRun, candidates: JSON.parse(String(candidates_json)) as unknown } };
  });
}
