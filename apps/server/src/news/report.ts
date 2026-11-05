import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import type { FormatsPlugin } from 'ajv-formats';
import { AppError } from '../errors.js';
import { proposalSchema, REPORT_SCHEMA, type Proposal, type ProposalItem } from './report-schema.js';
import type { ArticleCandidate } from './types.js';

const ajv = new Ajv({ allErrors: true, strict: true, coerceTypes: false, removeAdditional: false });
(addFormats as unknown as FormatsPlugin)(ajv); // Callable CJS export under NodeNext.
const validateReport = ajv.compile(REPORT_SCHEMA);
const validateProposal = ajv.compile<Proposal>(proposalSchema());
export interface ReportItem extends ProposalItem {
  verification: 'source_only' | 'codex_reported';
  source: { name: string; originalUrl: string; canonicalUrl: string; publishedAt: string | null; eventAt: string | null; fetchedAt: string | null };
}
export interface DailyReport {
  schemaVersion: 1; reportId: string; runId: string; reportDate: string; channel: 'opensource'; reviewStatus: 'pending';
  title: string; collectedAt: string; items: ReportItem[];
}
export function buildReport(output: string, candidates: ArticleCandidate[], metadata: {
  reportId: string; runId: string; reportDate: string; collectedAt: string;
}, mode:'verified'|'codex_reported'='verified'): DailyReport {
  if(mode!=='verified'&&mode!=='codex_reported')throw new AppError('report_provenance_invalid');
  let proposal: unknown;
  try { proposal = JSON.parse(output); } catch { throw new AppError('report_invalid_json'); }
  if (!validateProposal(proposal)) throw new AppError('report_schema_invalid');
  const typed = proposal;
  const byId = new Map(candidates.map((article) => [article.id, article]));
  const seen = new Set<string>();
  const items = typed.items.map((item): ReportItem => {
    const article = byId.get(item.articleId);
    if (!article) throw new AppError('report_unknown_article');
    if (seen.has(item.articleId)) throw new AppError('report_duplicate_article');
    seen.add(item.articleId);
    const consistent = mode==='codex_reported'
      ? article.sourceMode==='codex_reported' && article.fetchedAt===null && article.excerpt===''
      : (article.sourceMode===undefined || article.sourceMode==='verified') && typeof article.fetchedAt==='string';
    if(!consistent)throw new AppError('report_provenance_invalid');
    if (mode==='verified' && !article.title.includes(item.evidenceQuote) && !article.excerpt.includes(item.evidenceQuote)) throw new AppError('report_evidence_invalid');
    return { ...item, verification: mode==='codex_reported'?'codex_reported':'source_only', source: {
      name: article.sourceName, originalUrl: article.originalUrl, canonicalUrl: article.canonicalUrl,
      publishedAt: article.publishedAt, eventAt: article.eventAt, fetchedAt: article.fetchedAt,
    } };
  }).sort((a, b) => b.importance - a.importance || a.articleId.localeCompare(b.articleId));
  const report: DailyReport = { schemaVersion: 1, ...metadata, channel: 'opensource', reviewStatus: 'pending', title: typed.title, items };
  if (!validateReport(report)) throw new AppError('report_schema_invalid');
  return report;
}
function markdownText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_[\]{}|#+!]/g, '\\$&');
}
export function reportMarkdown(report: DailyReport): string {
  return `# ${markdownText(report.title)}\n\n日期：${report.reportDate}；待人工审核。来源关联和格式校验不等于独立事实核验。\n\n` + report.items.map((item) => {
    const url = item.source.canonicalUrl.replace(/\(/g, '%28').replace(/\)/g, '%29');
    return `## ${markdownText(item.factSummary)}\n\n来源：[${markdownText(item.source.name)}](${url})\n\n原始发布时间：${item.source.publishedAt ?? '未知'}；事件时间：${item.source.eventAt ?? '未知'}；首次抓取：${item.source.fetchedAt ?? '未抓取（Codex 提供）'}\n\n${item.verification==='codex_reported'?'Codex 提供的引文':'依据原文'}：${markdownText(item.evidenceQuote)}\n\n分析（推断）：${item.analysis ? markdownText(item.analysis) : '无'}\n`;
  }).join('\n');
}
