import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import type { FormatsPlugin } from 'ajv-formats';
import { AppError } from '../errors.js';
import { proposalSchema, REPORT_SCHEMA, type Proposal, type ProposalItem } from './report-schema.js';
import { validateInvestmentDetails, type InvestmentDetails } from './investment-details.js';
import { validateNewsDetails, type NewsDetails } from './news-details.js';
import type { ArticleCandidate } from './types.js';

const ajv = new Ajv({ allErrors: true, strict: true, coerceTypes: false, removeAdditional: false });
(addFormats as unknown as FormatsPlugin)(ajv); // Callable CJS export under NodeNext.
const validateReport = ajv.compile(REPORT_SCHEMA);
const validateProposal = ajv.compile<Proposal>(proposalSchema());
export interface ReportItem extends ProposalItem {
  verification: 'source_only' | 'codex_reported';
  source: { name: string; originalUrl: string; canonicalUrl: string; publishedAt: string | null; eventAt: string | null; fetchedAt: string | null };
}
export interface PublicTopic { id: string; name: string }
export interface DailyReport {
  schemaVersion: 1; reportId: string; runId: string; reportDate: string; channel: 'opensource'; reviewStatus: 'pending';
  title: string; collectedAt: string; items: ReportItem[]; topic?: PublicTopic;
}
export function buildReport(output: string, candidates: ArticleCandidate[], metadata: {
  reportId: string; runId: string; reportDate: string; collectedAt: string; topic?: PublicTopic;
}, mode:'verified'|'codex_reported'='verified'): DailyReport {
  if(mode!=='verified'&&mode!=='codex_reported')throw new AppError('report_provenance_invalid');
  let proposal: unknown;
  try { proposal = JSON.parse(output); } catch { throw new AppError('report_invalid_json'); }
  if (!validateProposal(proposal)) throw new AppError('report_schema_invalid');
  const typed = proposal;
  const byId = new Map(candidates.map((article) => [article.id, article]));
  const seen = new Set<string>();
  const items = typed.items.map((item): ReportItem => {
    if(item.details){if(item.details.kind==='news')validateNewsDetails(item.details);else validateInvestmentDetails(item.details);}
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
function detailsMarkdown(details:InvestmentDetails):string {
  const lines=[`### 研究详情\n\n事件背景：${markdownText(details.background)}`];
  if(details.metrics?.length)lines.push(`核心数据：\n${details.metrics.map(metric=>`- ${markdownText(metric.name)}：${markdownText(metric.value)} ${markdownText(metric.unit)}（${markdownText(metric.period)}；${markdownText(metric.basis)}${metric.comparison?`；${markdownText(metric.comparison)}`:''}；证据 ${metric.evidenceRefs.map(markdownText).join('、')}）`).join('\n')}`);
  if(details.supplyChain?.length)lines.push(`产业链影响：\n${details.supplyChain.map(item=>`- ${markdownText(item.segment)}：${markdownText(item.direction)}；${markdownText(item.reason)}（${item.relationship==='confirmed'?'已确认关系':'潜在影响'}）`).join('\n')}`);
  if(details.investmentLogic)lines.push(`投资逻辑：${markdownText(details.investmentLogic)}`);
  if(details.watchpoints?.length)lines.push(`后续观察：${details.watchpoints.map(markdownText).join('；')}`);
  if(details.risks?.length)lines.push(`风险与反证：${details.risks.map(markdownText).join('；')}`);
  if(details.valuation)lines.push(`估值与市场预期：${markdownText(details.valuation)}`);
  if(details.evidence?.length)lines.push(`补充证据：\n${details.evidence.map(source=>`- ${markdownText(source.id)} ${markdownText(source.name)}：[查看原文](${source.url.replace(/\(/g,'%28').replace(/\)/g,'%29')})；支持 ${markdownText(source.supports)}`).join('\n')}`);
  return lines.join('\n\n');
}
function newsDetailsMarkdown(details:NewsDetails):string {
  const lines=[`### 新闻详情\n\n事件背景：${markdownText(details.background)}`];
  const withRefs=(refs?:string[])=>refs?.length?`（证据 ${refs.map(markdownText).join('、')}）`:'';
  if(details.keyFacts?.length)lines.push(`关键事实：\n${details.keyFacts.map(f=>`- ${markdownText(f.name)}：${markdownText(f.value)}${f.unit?` ${markdownText(f.unit)}`:''}${f.period?`；${markdownText(f.period)}`:''}；${markdownText(f.nature)}${withRefs(f.evidenceRefs)}`).join('\n')}`);
  if(details.timeline?.length)lines.push(`事件时间线：\n${details.timeline.map(e=>`- ${markdownText(e.time)}：${markdownText(e.event)}${withRefs(e.evidenceRefs)}`).join('\n')}`);
  if(details.positions?.length)lines.push(`各方表态：\n${details.positions.map(p=>`- ${markdownText(p.actor)}（${p.form==='quote'?'原话':'转述'}）：${markdownText(p.statement)}${withRefs(p.evidenceRefs)}`).join('\n')}`);
  if(details.impacts?.length)lines.push(`影响：\n${details.impacts.map(i=>`- ${i.status==='observed'?'已观察':'分析推断'}：${markdownText(i.description)}${withRefs(i.evidenceRefs)}`).join('\n')}`);
  if(details.uncertainties?.length)lines.push(`未确定事项：${details.uncertainties.map(markdownText).join('；')}`);
  if(details.watchpoints?.length)lines.push(`后续观察：${details.watchpoints.map(markdownText).join('；')}`);
  if(details.evidence?.length)lines.push(`补充证据：\n${details.evidence.map(s=>`- ${markdownText(s.id)} ${markdownText(s.name)}：[查看原文](${s.url.replace(/\(/g,'%28').replace(/\)/g,'%29')})；支持 ${markdownText(s.supports)}`).join('\n')}`);
  return lines.join('\n\n');
}
export function reportMarkdown(report: DailyReport): string {
  return `# ${markdownText(report.title)}\n\n日期：${report.reportDate}；待人工审核。来源关联和格式校验不等于独立事实核验。\n\n` + report.items.map((item) => {
    const url = item.source.canonicalUrl.replace(/\(/g, '%28').replace(/\)/g, '%29');
    return `## ${markdownText(item.factSummary)}\n\n来源：[${markdownText(item.source.name)}](${url})\n\n原始发布时间：${item.source.publishedAt ?? '未知'}；事件时间：${item.source.eventAt ?? '未知'}；首次抓取：${item.source.fetchedAt ?? '未抓取（Codex 提供）'}\n\n${item.verification==='codex_reported'?'Codex 提供的引文':'依据原文'}：${markdownText(item.evidenceQuote)}\n\n分析（推断）：${item.analysis ? markdownText(item.analysis) : '无'}\n${item.details?`\n${item.details.kind==='news'?newsDetailsMarkdown(item.details):detailsMarkdown(item.details)}\n`:''}`;
  }).join('\n');
}
