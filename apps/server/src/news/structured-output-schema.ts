import { HEADLINES_RESEARCH_SCHEMA, OPEN_SOURCE_RESEARCH_SCHEMA, RESEARCH_SCHEMA, TECHNOLOGY_RESEARCH_SCHEMA } from './report-schema.js';

type Schema = Record<string, unknown>;

// Codex structured output requires every object property to be required.
// Keep the archive schema optional; encode omitted values as null only on the wire.
function strictSchema(schema: Schema): Schema {
  const result: Schema = {};
  for (const name of ['type', 'title', 'description', 'enum', 'const', 'pattern', 'format',
    'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
    'minItems', 'maxItems', 'additionalProperties'])
    if (Object.hasOwn(schema, name)) result[name] = schema[name];
  if (Array.isArray(schema.oneOf)) {
    result.anyOf = (schema.oneOf as Schema[]).map(strictSchema);
  } else if (Array.isArray(schema.anyOf)) {
    result.anyOf = (schema.anyOf as Schema[]).map(strictSchema);
  }
  if (schema.items && typeof schema.items === 'object')
    result.items = strictSchema(schema.items as Schema);
  if (schema.type === 'object' && schema.properties && typeof schema.properties === 'object') {
    const properties = schema.properties as Record<string, Schema>;
    const required = new Set(Array.isArray(schema.required) ? schema.required as string[] : []);
    result.properties = Object.fromEntries(Object.entries(properties).map(([name, property]) => {
      const converted = strictSchema(property);
      return [name, required.has(name) ? converted : { anyOf: [converted, { type: 'null' }] }];
    }));
    result.required = Object.keys(properties);
  }
  return result;
}

export const CODEX_RESEARCH_SCHEMA = strictSchema(RESEARCH_SCHEMA as unknown as Schema);
export const CODEX_OPEN_SOURCE_RESEARCH_SCHEMA = strictSchema(OPEN_SOURCE_RESEARCH_SCHEMA as unknown as Schema);
export const CODEX_HEADLINES_RESEARCH_SCHEMA = strictSchema(HEADLINES_RESEARCH_SCHEMA as unknown as Schema);
export const CODEX_TECHNOLOGY_RESEARCH_SCHEMA = strictSchema(TECHNOLOGY_RESEARCH_SCHEMA as unknown as Schema);

function normalize(value: unknown, schema: Schema): unknown {
  if (Array.isArray(value))
    return schema.items && typeof schema.items === 'object'
      ? value.map(item => normalize(item, schema.items as Schema)) : value;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(schema.oneOf)) {
    const alternatives = schema.oneOf as Schema[];
    const kind = (value as Record<string, unknown>).kind;
    const selected = alternatives.find(option =>
      (option.properties as Record<string, Schema> | undefined)?.kind?.const === kind);
    if (selected) return normalize(value, selected);
  }
  const properties = schema.properties as Record<string, Schema> | undefined;
  if (!properties) return value;
  const required = new Set(Array.isArray(schema.required) ? schema.required as string[] : []);
  return Object.fromEntries(Object.entries(value).filter(([name, field]) =>
    field !== null || required.has(name) || !Object.hasOwn(properties, name)).map(([name, field]) =>
      [name, properties[name] ? normalize(field, properties[name]) : field]));
}

export function normalizeResearchOutput(value: unknown, schema: Schema = RESEARCH_SCHEMA as unknown as Schema): unknown {
  return normalize(value, schema);
}
