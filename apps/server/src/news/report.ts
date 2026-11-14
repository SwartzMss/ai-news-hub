import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import type { FormatsPlugin } from 'ajv-formats';
import { AppError } from '../errors.js';
import { proposalSchema, REPORT_SCHEMA, TECHNOLOGY_REPORT_SCHEMA, TECHNOLOGY_CATEGORIES, RESEARCH_AREAS, type Proposal, type ProposalItem, type ResearchArea } from './report-schema.js';
import { validateInvestmentDetails, type InvestmentDetails } from './investment-details.js';
import { validateNewsDetails, type NewsDetails } from './news-details.js';
import { validateProjectDetails, type ProjectDetails } from './project-details.js';
import type { ArticleCandidate } from './types.js';

const ajv = new Ajv({ allErrors: true, strict: true, coerceTypes: false, removeAdditional: false });
(addFormats as unknown as FormatsPlugin)(ajv); // Callable CJS export under NodeNext.
const validateReport = ajv.compile(REPORT_SCHEMA);
const validateTechnologyReport = ajv.compile(TECHNOLOGY_REPORT_SCHEMA);
const validateProposal = ajv.compile<Proposal>(proposalSchema());
const validateTechnologyProposal = ajv.compile<Proposal>(proposalSchema(undefined, TECHNOLOGY_CATEGORIES));
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
}, mode:'verified'|'codex_reported'='verified', categoryScope:'general'|'technology'='general'): DailyReport {
  if(mode!=='verified'&&mode!=='codex_reported')throw new AppError('report_provenance_invalid');
  let proposal: unknown;
  try { proposal = JSON.parse(output); } catch { throw new AppError('report_invalid_json'); }
  const validProposal = categoryScope==='technology' ? validateTechnologyProposal : validateProposal;
  if (!validProposal(proposal)) throw new AppError('report_schema_invalid');
  const typed = proposal;
  const byId = new Map(candidates.map((article) => [article.id, article]));
  const seen = new Set<string>();
  const items = typed.items.map((item): ReportItem => {
    if(item.details){if(item.details.kind==='news')validateNewsDetails(item.details);else if(item.details.kind==='project')validateProjectDetails(item.details);else validateInvestmentDetails(item.details);}
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
  }).sort((a, b) => {
    const rank = (area?: ResearchArea) => area ? RESEARCH_AREAS.indexOf(area) : RESEARCH_AREAS.length;
    return rank(a.researchArea) - rank(b.researchArea) ||
      b.importance - a.importance || a.articleId.localeCompare(b.articleId);
  });
  const report: DailyReport = { schemaVersion: 1, ...metadata, channel: 'opensource', reviewStatus: 'pending', title: typed.title, items };
  const validReport = categoryScope==='technology' ? validateTechnologyReport : validateReport;
  if (!validReport(report)) throw new AppError('report_schema_invalid');
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
  if(details.trendTags?.length)lines.push(`传播标签：${details.trendTags.map(markdownText).join('、')}`);
  if(details.discussionTags?.length)lines.push(`讨论类型标签：${details.discussionTags.map(markdownText).join('、')}`);
  if(details.trendSignals?.length)lines.push(`平台传播信号：\n${details.trendSignals.map(signal=>`- ${markdownText(signal.platform)} / ${markdownText(signal.contentType)}：${markdownText(signal.metric)} ${markdownText(signal.value)}；观察时间 ${markdownText(signal.observedAt)}；${signal.evidenceType==='direct'?'直接观察':'来源转述'}；证据 ${signal.evidenceRefs.map(markdownText).join('、')}`).join('\n')}`);
  if(details.publicDiscussion)lines.push(`公众讨论：${markdownText(details.publicDiscussion.summary)}；证据 ${details.publicDiscussion.evidenceRefs.map(markdownText).join('、')}${details.publicDiscussion.viewpoints?.length?`\n主要观点：\n${details.publicDiscussion.viewpoints.map(view=>`- ${markdownText(view.label)}（${markdownText(view.sentiment)}）：${markdownText(view.summary)}${withRefs(view.evidenceRefs)}`).join('\n')}`:''}${details.publicDiscussion.controversies?.length?`\n争议焦点：\n${details.publicDiscussion.controversies.map(item=>`- ${markdownText(item.topic)}：${item.sides.map(markdownText).join('；')}${withRefs(item.evidenceRefs)}`).join('\n')}`:''}${details.publicDiscussion.representativeComments?.length?`\n代表性评论：\n${details.publicDiscussion.representativeComments.map(item=>`- ${markdownText(item.platform)}：“${markdownText(item.quote)}”${withRefs(item.evidenceRefs)}`).join('\n')}`:''}`);
  if(details.evidence?.length)lines.push(`补充证据：\n${details.evidence.map(s=>`- ${markdownText(s.id)} ${markdownText(s.name)}：[查看原文](${s.url.replace(/\(/g,'%28').replace(/\)/g,'%29')})；支持 ${markdownText(s.supports)}`).join('\n')}`);
  return lines.join('\n\n');
}
function projectDetailsMarkdown(details:ProjectDetails):string {
  const lines=[`### 项目详情\n\n项目概览：${markdownText(details.overview)}`];
  const refs=(ids?:string[])=>ids?.length?`（证据 ${ids.map(markdownText).join('、')}）`:'';
  if(details.change)lines.push(`本次更新：${markdownText(details.change.summary)}${details.change.version?`；版本 ${markdownText(details.change.version)}`:''}${details.change.publishedAt?`；发布日期 ${details.change.publishedAt}`:''}${refs(details.change.evidenceRefs)}`);
  if(details.technical?.length)lines.push(`技术与架构：\n${details.technical.map(p=>`- ${markdownText(p.description)}${refs(p.evidenceRefs)}`).join('\n')}`);
  if(details.useCases?.length)lines.push(`适用场景：\n${details.useCases.map(p=>`- ${markdownText(p.description)}${refs(p.evidenceRefs)}`).join('\n')}`);
  if(details.license)lines.push(`代码许可证：${markdownText(details.license.code)}${details.license.scope?`；授权范围：${markdownText(details.license.scope)}`:''}${refs(details.license.evidenceRefs)}`);
  if(details.evaluation?.length)lines.push(`试用建议与限制：\n${details.evaluation.map(p=>`- ${p.nature==='analysis'?'编辑判断':'来源事实'}：${markdownText(p.description)}${refs(p.evidenceRefs)}`).join('\n')}`);
  lines.push(`来源与证据：\n${details.evidence.map(s=>`- ${markdownText(s.id)} ${markdownText(s.name)}：[查看原文](${s.url.replace(/\(/g,'%28').replace(/\)/g,'%29')})；支持 ${markdownText(s.supports)}`).join('\n')}`);
  return lines.join('\n\n');
}
export function reportMarkdown(report: DailyReport): string {
  return `# ${markdownText(report.title)}\n\n日期：${report.reportDate}；待人工审核。来源关联和格式校验不等于独立事实核验。\n\n` + report.items.map((item) => {
    const url = item.source.canonicalUrl.replace(/\(/g, '%28').replace(/\)/g, '%29');
    const areaLabels: Record<ResearchArea, string> = {agent:'AI Agent 与自动化执行',rust:'Rust 生态与工程工具',multimedia:'AI 视频、音频与多媒体创作',performance_security:'性能分析与软件安全',decentralized:'区块链与去中心化基础设施'};
    const areaPrefix = item.researchArea ? `【${areaLabels[item.researchArea]}】` : '';
    return `## ${areaPrefix}${markdownText(item.factSummary)}\n\n来源：[${markdownText(item.source.name)}](${url})\n\n原始发布时间：${item.source.publishedAt ?? '未知'}；事件时间：${item.source.eventAt ?? '未知'}；首次抓取：${item.source.fetchedAt ?? '未抓取（Codex 提供）'}\n\n${item.verification==='codex_reported'?'Codex 提供的引文':'依据原文'}：${markdownText(item.evidenceQuote)}\n\n分析（推断）：${item.analysis ? markdownText(item.analysis) : '无'}\n${item.details?`\n${item.details.kind==='news'?newsDetailsMarkdown(item.details):item.details.kind==='project'?projectDetailsMarkdown(item.details):detailsMarkdown(item.details)}\n`:''}`;
  }).join('\n');
}
