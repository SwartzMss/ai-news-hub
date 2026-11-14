import { REPORT_SCHEMA, PUBLIC_TOPIC_SCHEMA, REPORT_CATEGORIES } from "../news/report-schema.js";
import { TECHNOLOGY_INVESTMENT_DETAILS_SCHEMA } from "../news/investment-details.js";
import { HEADLINES_DETAILS_SCHEMA } from "../news/news-details.js";
import { PROJECT_RESEARCH_DETAILS_SCHEMA } from "../news/project-details.js";

const original = REPORT_SCHEMA.properties.items.items.properties;
const source = original.source.properties;
const root = {
  schema_version: { const: 1 },
  topic: PUBLIC_TOPIC_SCHEMA,
  report_id: { type: "string", minLength: 1, maxLength: 256 },
  report_date: { type: "string", format: "date" },
  channel: { const: "opensource" },
  version: { type: "integer", minimum: 1, maximum: 999999 },
  title: REPORT_SCHEMA.properties.title,
  collected_at: { type: "string", format: "date-time" },
  review_status: { const: "approved" },
  approved_at: { type: "string", format: "date-time" },
  reviewed_content_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
  items: {
    type: "array",
    minItems: 1,
    maxItems: 10,
    items: {
      type: "object",
      additionalProperties: false,
      required: [
        "id", "category", "importance", "fact_summary", "analysis",
        "evidence_quote", "details", "verification", "source",
      ],
      allOf: [{
        if: { properties: { verification: { const: "codex_reported" } } },
        then: { properties: { source: { type: "object", properties: { fetched_at: { type: "null" } } } } },
        else: { properties: { source: { type: "object", properties: { fetched_at: { type: "string", format: "date-time" } } } } },
      }],
      properties: {
        id: original.articleId,
        category: { type: "string", enum: [...REPORT_CATEGORIES] },
        importance: original.importance,
        fact_summary: original.factSummary,
        analysis: original.analysis,
        evidence_quote: original.evidenceQuote,
        research_area: original.researchArea,
        details: { oneOf: [PROJECT_RESEARCH_DETAILS_SCHEMA, TECHNOLOGY_INVESTMENT_DETAILS_SCHEMA, HEADLINES_DETAILS_SCHEMA] },
        verification: original.verification,
        source: {
          type: "object",
          additionalProperties: false,
          required: ["name", "original_url", "canonical_url", "published_at", "event_at", "fetched_at"],
          properties: {
            name: source.name,
            original_url: source.originalUrl,
            canonical_url: source.canonicalUrl,
            published_at: source.publishedAt,
            event_at: source.eventAt,
            fetched_at: source.fetchedAt,
          },
        },
      },
    },
  },
};
export const ARCHIVE_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  additionalProperties: false,
  required: Object.keys(root),
  properties: root,
};
