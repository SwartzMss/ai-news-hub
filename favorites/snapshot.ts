import { AuthError } from '../auth/runtime.js';

type Rule = 'text' | 'long' | 'nullableLong' | 'url' | 'httpsUrl' | 'date' | 'datetime' | 'dateOrDateTime' | 'nullableDateTime' | 'key' | 'topicId' | 'details'
  | { values: readonly (string | number)[] } | { number: [number, number] }
  | { array: Rule; max: number } | { object: Record<string, Rule>; optional?: readonly string[] };
const values = (...choices: (string | number)[]): Rule => ({ values: choices });
const obj = (fields: Record<string, Rule>, optional: string[] = []): Rule => ({ object: fields, optional });
const arr = (rule: Rule, max = 40): Rule => ({ array: rule, max });
const short: Rule = 'text';
const long: Rule = 'long';
const refs = arr(short, 40);
const evidence = obj({ id: short, name: short, url: 'httpsUrl', supports: long });
const common = { evidence: arr(evidence, 40) };
const detailRules: Record<string, Rule> = {
  news: obj({ kind: values('news'), background: long, ...common,
    keyFacts: arr(obj({ name: short, value: long, unit: short, period: short, nature: values('confirmed', 'statement', 'reported', 'estimate', 'inference'), evidenceRefs: refs }, ['unit', 'period'])),
    timeline: arr(obj({ time: short, precision: values('date', 'datetime', 'approximate'), event: long, evidenceRefs: refs })),
    positions: arr(obj({ actor: short, statement: long, form: values('quote', 'paraphrase'), evidenceRefs: refs })),
    impacts: arr(obj({ description: long, status: values('observed', 'analysis'), evidenceRefs: refs }, ['evidenceRefs'])),
    uncertainties: arr(long), watchpoints: arr(long),
  }, ['keyFacts', 'timeline', 'positions', 'impacts', 'uncertainties', 'watchpoints']),
  investment: obj({ kind: values('investment'), background: long, ...common,
    metrics: arr(obj({ name: short, value: short, unit: short, period: short, comparison: short, basis: values('actual', 'guidance', 'consensus', 'estimate', 'inference'), evidenceRefs: refs }, ['comparison'])),
    supplyChain: arr(obj({ segment: short, direction: short, reason: long, relationship: values('confirmed', 'potential'), evidenceRefs: refs }, ['evidenceRefs'])),
    investmentLogic: long, watchpoints: arr(long), risks: arr(long), valuation: long,
  }, ['metrics', 'supplyChain', 'investmentLogic', 'watchpoints', 'risks', 'valuation']),
  project: obj({ kind: values('project'), overview: long, ...common,
    change: obj({ summary: long, version: short, type: values('release', 'feature', 'technical', 'community'), publishedAt: 'dateOrDateTime', evidenceRefs: refs }, ['version', 'type', 'publishedAt']),
    technical: arr(obj({ description: long, evidenceRefs: refs })),
    useCases: arr(obj({ description: long, evidenceRefs: refs })),
    license: obj({ code: short, scope: short, evidenceRefs: refs }, ['scope']),
    evaluation: arr(obj({ description: long, nature: values('fact', 'analysis'), evidenceRefs: refs }, ['evidenceRefs'])),
  }, ['change', 'technical', 'useCases', 'license', 'evaluation']),
};
const articleRule = obj({
  id: short, key: 'key', title: short, topic: obj({ id: 'topicId', name: short }), category: short,
  research_area: values('agent', 'rust', 'multimedia', 'performance_security', 'decentralized'),
  importance: { number: [1, 5] }, fact_summary: long, analysis: 'nullableLong', details: 'details',
  evidence_quote: long, verification: values('source_only', 'codex_reported'),
  source: obj({ name: short, original_url: 'url', canonical_url: 'url',
    published_at: 'nullableDateTime', event_at: 'nullableDateTime', fetched_at: 'nullableDateTime' }),
  report_date: 'date', report_version: { number: [1, 999999] }, first_approved_at: 'datetime',
}, ['research_area']);

function invalid(): never { throw new AuthError('invalid_snapshot', 400); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function check(value: unknown, rule: Rule, depth = 0): void {
  if (depth > 9) invalid();
  if (typeof rule === 'object') {
    if ('values' in rule) { if (!rule.values.includes(value as string | number)) invalid(); return; }
    if ('number' in rule) { if (!Number.isInteger(value) || (value as number) < rule.number[0] || (value as number) > rule.number[1]) invalid(); return; }
    if ('array' in rule) {
      if (!Array.isArray(value) || value.length > rule.max) invalid();
      for (const entry of value) check(entry, rule.array, depth + 1);
      return;
    }
    const fields = record(value);
    const allowed = Object.keys(rule.object);
    if (Object.keys(fields).some(key => !allowed.includes(key))) invalid();
    for (const [key, spec] of Object.entries(rule.object)) {
      if (!(key in fields)) { if (!rule.optional?.includes(key)) invalid(); continue; }
      check(fields[key], spec, depth + 1);
    }
    return;
  }
  if ((rule === 'nullableDateTime' || rule === 'nullableLong') && value === null) return;
  if (rule === 'details') { record(value); return; }
  if (typeof value !== 'string' || !value || value.length > (rule === 'long' || rule === 'nullableLong' ? 4000 : rule === 'url' || rule === 'httpsUrl' ? 2048 : 256)
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) || /<\s*\/?[a-z][^>]*>/iu.test(value)) invalid();
  if (rule === 'key' && !/^[0-9a-f]{32}$/.test(value)) invalid();
  if (rule === 'topicId' && !/^t-[0-9a-f]{24}$/.test(value)) invalid();
  if (rule === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)))) invalid();
  if (rule === 'dateOrDateTime') { if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value) || Number.isNaN(Date.parse(value))) invalid(); }
  if ((rule === 'datetime' || rule === 'nullableDateTime') && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || Number.isNaN(Date.parse(value)))) invalid();
  if (rule === 'url' || rule === 'httpsUrl') {
    try {
      const url = new URL(value);
      if (!['https:', ...(rule === 'url' ? ['http:'] : [])].includes(url.protocol) || url.username || url.password || !url.hostname || /\s/u.test(value)) invalid();
    } catch { invalid(); }
  }
}

export interface FavoriteSnapshot { schemaVersion: 1; article: Record<string, unknown> }
export async function validateSnapshot(raw: unknown): Promise<FavoriteSnapshot> {
  const article = record(raw);
  check(article, articleRule);
  const details = record(article.details);
  const kind = details.kind;
  if (typeof kind !== 'string' || !detailRules[kind]) invalid();
  check(details, detailRules[kind]);
  const ids = new Set((details.evidence as { id: string }[]).map(item => item.id));
  if (ids.size !== (details.evidence as unknown[]).length) invalid();
  const refsValid = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(refsValid); return; }
    if (!value || typeof value !== 'object') return;
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'evidenceRefs' && Array.isArray(entry) && entry.some(id => !ids.has(id))) invalid();
      refsValid(entry);
    }
  };
  refsValid(details);
  const data = new TextEncoder().encode(`${(article.topic as { id: string }).id}:${article.id}`);
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  const key = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 32);
  if (article.key !== key) invalid();
  return { schemaVersion: 1, article };
}
