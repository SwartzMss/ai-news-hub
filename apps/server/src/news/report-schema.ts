import { INVESTMENT_DETAILS_SCHEMA, type InvestmentDetails } from './investment-details.js';
import { NEWS_DETAILS_SCHEMA, type NewsDetails } from './news-details.js';
import { PROJECT_DETAILS_SCHEMA, type ProjectDetails } from './project-details.js';
const text = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength });
const nullableTime = { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] };
const categories = ['ai', 'opensource', 'developer_tools', 'security', 'industry', 'other'];
export interface ProposalItem {
  articleId: string; category: string; importance: number; factSummary: string; analysis: string | null; evidenceQuote: string; details?: InvestmentDetails | NewsDetails | ProjectDetails;
}
export interface Proposal { title: string; items: ProposalItem[] }
const proposalItem = {
  type: 'object', additionalProperties: false,
  required: ['articleId', 'category', 'importance', 'factSummary', 'analysis', 'evidenceQuote'],
  properties: {
    articleId: text(256), category: { type: 'string', enum: categories }, importance: { type: 'integer', minimum: 1, maximum: 5 },
    factSummary: text(600), analysis: { anyOf: [text(600), { type: 'null' }] },
    evidenceQuote: { type: 'string', minLength: 8, maxLength: 240 }, details: { oneOf: [INVESTMENT_DETAILS_SCHEMA, NEWS_DETAILS_SCHEMA, PROJECT_DETAILS_SCHEMA] },
  },
};
export function proposalSchema(articleIds?: string[]) {
  return {
    type: 'object', additionalProperties: false, required: ['title', 'items'],
    properties: { title: text(180), items: {
      type: 'array', minItems: 1, maxItems: articleIds ? Math.min(10, articleIds.length) : 10,
      items: { ...proposalItem, properties: { ...proposalItem.properties, articleId: articleIds ? { type: 'string', enum: articleIds } : text(256) } },
    } },
  };
}
export const RESEARCH_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['title','items'],
  properties: { title: text(180), items: { type: 'array', minItems: 1, maxItems: 10, items: {
    ...proposalItem,
    required: [...proposalItem.required.filter(key => key !== 'articleId'), 'url'],
    properties: Object.fromEntries([...Object.entries(proposalItem.properties).filter(([key]) => key !== 'articleId'), ['url', {type:'string',minLength:1,maxLength:2048}]]),
  } } },
};
export const PUBLIC_TOPIC_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['id', 'name'],
  properties: { id: { type: 'string', pattern: '^t-[a-f0-9]{24}$' }, name: text(200) },
};
export const REPORT_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'reportId', 'runId', 'reportDate', 'channel', 'reviewStatus', 'title', 'collectedAt', 'items'],
  properties: {
    topic: PUBLIC_TOPIC_SCHEMA,
    schemaVersion: { const: 1 }, reportId: text(256), runId: text(256), reportDate: { type: 'string', format: 'date' },
    channel: { const: 'opensource' }, reviewStatus: { const: 'pending' }, title: text(180),
    collectedAt: { type: 'string', format: 'date-time' }, items: {
      type: 'array', minItems: 1, maxItems: 10, items: {
        ...proposalItem,
        required: [...proposalItem.required, 'verification', 'source'],
        allOf:[{if:{properties:{verification:{const:'codex_reported'}}},then:{properties:{source:{type:'object',properties:{fetchedAt:{type:'null'}}}}},else:{properties:{source:{type:'object',properties:{fetchedAt:{type:'string',format:'date-time'}}}}}}],
        properties: { ...proposalItem.properties,
          verification: { enum: ['source_only','codex_reported'] }, source: {
            type: 'object', additionalProperties: false,
            required: ['name', 'originalUrl', 'canonicalUrl', 'publishedAt', 'eventAt', 'fetchedAt'],
            properties: {
              name: text(200), originalUrl: { type: 'string', format: 'uri', maxLength: 2048 },
              canonicalUrl: { type: 'string', format: 'uri', maxLength: 2048 },
              publishedAt: nullableTime, eventAt: nullableTime, fetchedAt: nullableTime,
            },
          },
        },
      },
    },
  },
};
