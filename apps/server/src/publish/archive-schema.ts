import { REPORT_SCHEMA, PUBLIC_TOPIC_SCHEMA, TECHNOLOGY_CATEGORIES } from "../news/report-schema.js";
import { TECHNOLOGY_INVESTMENT_DETAILS_SCHEMA } from "../news/investment-details.js";
import { HEADLINES_DETAILS_SCHEMA, HEADLINE_CATEGORIES, LEGACY_NEWS_DETAILS_SCHEMA } from "../news/news-details.js";
const original = REPORT_SCHEMA.properties.items.items.properties;
const source = original.source.properties;
const extendedDetails = original.details;
const legacyDetails = {
  oneOf: [extendedDetails.oneOf[0], LEGACY_NEWS_DETAILS_SCHEMA, extendedDetails.oneOf[2]],
};
const legacyCategory = {
  type: "string",
  enum: ["ai", "opensource", "developer_tools", "security", "industry", "other"],
};
const properties = {
  id: original.articleId,
  category: original.category,
  importance: original.importance,
  fact_summary: original.factSummary,
  analysis: original.analysis,
  evidence_quote: original.evidenceQuote,
  details: extendedDetails,
  verification: original.verification,
  source: {
    type: "object",
    additionalProperties: false,
    required: [
      "name",
      "original_url",
      "canonical_url",
      "published_at",
      "event_at",
      "fetched_at",
    ],
    properties: {
      name: source.name,
      original_url: source.originalUrl,
      canonical_url: source.canonicalUrl,
      published_at: source.publishedAt,
      event_at: source.eventAt,
      fetched_at: source.fetchedAt,
    },
  },
};
const legacyProperties = {
  ...properties,
  category: legacyCategory,
  details: legacyDetails,
};
const root = {
  schema_version: { const: 1 },
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
      required: Object.keys(legacyProperties).filter(key=>key!=='details'),
      allOf:[{if:{properties:{verification:{const:"codex_reported"}}},then:{properties:{source:{type:"object",properties:{fetched_at:{type:"null"}}}}},else:{properties:{source:{type:"object",properties:{fetched_at:{type:"string",format:"date-time"}}}}}}],
      properties: legacyProperties,
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

export const ARCHIVE_V2_SCHEMA = {
  ...ARCHIVE_SCHEMA,
  required: [...ARCHIVE_SCHEMA.required, 'topic'],
  properties: { ...ARCHIVE_SCHEMA.properties, schema_version: { const: 2 }, topic: PUBLIC_TOPIC_SCHEMA },
};
const v3Properties = { ...legacyProperties, research_area: original.researchArea };
export const ARCHIVE_V3_SCHEMA = {
  ...ARCHIVE_V2_SCHEMA,
  properties: {
    ...ARCHIVE_V2_SCHEMA.properties,
    schema_version: { const: 3 },
    items: {
      ...root.items,
      items: {
        ...root.items.items,
        required: [...root.items.items.required, 'research_area'],
        properties: v3Properties,
      },
    },
  },
};
const v4Properties = {
  ...properties,
  category: { type: "string", enum: [...HEADLINE_CATEGORIES] },
  details: HEADLINES_DETAILS_SCHEMA,
};
export const ARCHIVE_V4_SCHEMA = {
  ...ARCHIVE_V2_SCHEMA,
  properties: {
    ...ARCHIVE_V2_SCHEMA.properties,
    schema_version: { const: 4 },
    items: {
      ...root.items,
      items: {
        ...root.items.items,
        required: [...root.items.items.required, 'details'],
        properties: v4Properties,
      },
    },
  },
};

const v5Properties = {
  ...properties,
  category: { type: "string", enum: [...TECHNOLOGY_CATEGORIES] },
  details: TECHNOLOGY_INVESTMENT_DETAILS_SCHEMA,
};
export const ARCHIVE_V5_SCHEMA = {
  ...ARCHIVE_V2_SCHEMA,
  properties: {
    ...ARCHIVE_V2_SCHEMA.properties,
    schema_version: { const: 5 },
    items: {
      ...root.items,
      items: {
        ...root.items.items,
        required: [...root.items.items.required, 'details'],
        properties: v5Properties,
      },
    },
  },
};
