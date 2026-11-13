import { validateTextTree } from "./text.mjs";
import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { createHash } from "node:crypto";
import { Ajv } from "ajv";
import addFormats from "ajv-formats";
const readSchema = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../../docs/schema/${name}`, import.meta.url),
      "utf8",
    ),
  );
const ajv = new Ajv({
  strict: true,
  coerceTypes: false,
  removeAdditional: false,
});
addFormats(ajv);
const validators = {
  1: ajv.compile(readSchema("report-archive-v1.schema.json")),
  2: ajv.compile(readSchema("report-archive-v2.schema.json")),
  3: ajv.compile(readSchema("report-archive-v3.schema.json")),
};
const topicSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "name"],
  properties: {
    id: { type: "string", pattern: "^t-[a-f0-9]{24}$" },
    name: { type: "string", minLength: 1, maxLength: 200 },
  },
};
const validateAssignments = ajv.compile({
  type: "object",
  additionalProperties: false,
  required: ["schema_version", "assignments"],
  properties: {
    schema_version: { const: 1 },
    assignments: {
      type: "array",
      maxItems: 10000,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["report_id", "topic"],
        properties: {
          report_id: { type: "string", minLength: 1, maxLength: 256 },
          topic: topicSchema,
        },
      },
    },
  },
});
export const articleKey = (id, topicId) =>
  createHash("sha256")
    .update(topicId ? `${topicId}:${id}` : id)
    .digest("hex")
    .slice(0, 32);
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function safeUrl(raw) {
  const u = new URL(raw);
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    /[\s\u0000-\u001f]/u.test(raw)
  )
    throw Error("unsafe source URL");
}
export function readArchives(
  root,
  { allowDemo = false, allowMissing = false } = {},
) {
  root = resolve(root);
  let entries = 0;
  const rawReports = [],
    assignments = new Map();
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      compare(a.name, b.name),
    )) {
      const file = join(dir, entry.name),
        stat = lstatSync(file),
        name = relative(root, file);
      if (stat.isSymbolicLink()) throw Error("archive symlinks forbidden");
      if (stat.isDirectory()) {
        if (name.split("/").length > 5)
          throw Error("unexpected archive directory");
        walk(file);
        continue;
      }
      if (!stat.isFile() || stat.size > 256 * 1024)
        throw Error("unexpected archive file");
      if (name === "topics.json") {
        const map = JSON.parse(readFileSync(file, "utf8"));
        validateTextTree(map);
        if (!validateAssignments(map)) throw Error("invalid topic assignments");
        for (const item of map.assignments) {
          if (assignments.has(item.report_id))
            throw Error("duplicate topic assignment");
          assignments.set(item.report_id, item.topic);
        }
        continue;
      }
      const old =
        /^(\d{4})\/(\d{2})\/(\d{2})\/opensource\/v(\d{6})\.json$/.exec(name);
      const scoped =
        /^topics\/(t-[a-f0-9]{24})\/(\d{4})\/(\d{2})\/(\d{2})\/v(\d{6})\.json$/.exec(
          name,
        );
      if ((!old && !scoped) || ++entries > 10000)
        throw Error("unexpected archive file");
      const report = JSON.parse(readFileSync(file, "utf8"));
      validateTextTree(report);
      if (!validators[report.schema_version]?.(report))
        throw Error("invalid archive schema: " + name);
      if (
        old
          ? report.schema_version !== 1 ||
            report.report_date !== old.slice(1, 4).join("-") ||
            report.version !== Number(old[4])
          : ![2, 3].includes(report.schema_version) ||
            report.topic.id !== scoped[1] ||
            report.report_date !== scoped.slice(2, 5).join("-") ||
            report.version !== Number(scoped[5])
      )
        throw Error("archive path mismatch");
      if (
        !allowDemo &&
        (/\[(?:TEST|DEMO)/i.test(report.title) ||
          /^issue\d+-.*test/i.test(report.report_id))
      )
        throw Error("test report forbidden in production");
      const seen = new Set();
      for (const item of report.items) {
        if (seen.has(item.id)) throw Error("duplicate article");
        seen.add(item.id);
        safeUrl(item.source.canonical_url);
        safeUrl(item.source.original_url);
        if(item.details){
          const ids=new Set();
          for(const evidence of item.details.evidence??[]){
            if(ids.has(evidence.id)||new URL(evidence.url).protocol!=='https:')throw Error('unsafe investment evidence');
            ids.add(evidence.id);safeUrl(evidence.url);
          }
          if(item.details.kind==='investment'){
            for(const metric of item.details.metrics??[])
              if(metric.evidenceRefs.some(id=>!ids.has(id)))throw Error('invalid investment evidence reference');
            for(const relation of item.details.supplyChain??[])
              if((relation.relationship==='confirmed'&&!relation.evidenceRefs?.length)||relation.evidenceRefs?.some(id=>!ids.has(id)))throw Error('invalid investment evidence reference');
          }else if(item.details.kind==='project'){
            const valid=refs=>!refs?.some(id=>!ids.has(id));
            if(!item.details.evidence?.length)throw Error('missing project evidence');
            for(const entry of [item.details.change,...(item.details.technical??[]),...(item.details.useCases??[]),item.details.license,...(item.details.evaluation??[])])
              if(entry&&((entry.nature==='fact'&&!entry.evidenceRefs?.length)||!valid(entry.evidenceRefs)))throw Error('invalid project evidence reference');
          }else if(item.details.kind==='news'){
            const valid=refs=>!refs?.some(id=>!ids.has(id));
            for(const entry of [...(item.details.keyFacts??[]),...(item.details.timeline??[]),...(item.details.positions??[])])
              if(!valid(entry.evidenceRefs))throw Error('invalid news evidence reference');
            for(const impact of item.details.impacts??[])
              if((impact.status==='observed'&&!impact.evidenceRefs?.length)||!valid(impact.evidenceRefs))throw Error('invalid news evidence reference');
            for(const signal of item.details.trendSignals??[])
              if(!valid(signal.evidenceRefs))throw Error('invalid news trend evidence reference');
            if(item.details.publicDiscussion){
              if(!valid(item.details.publicDiscussion.evidenceRefs))throw Error('invalid news discussion evidence reference');
              for(const entry of [...(item.details.publicDiscussion.viewpoints??[]),...(item.details.publicDiscussion.controversies??[]),...(item.details.publicDiscussion.representativeComments??[])])
                if(!valid(entry.evidenceRefs))throw Error('invalid news discussion evidence reference');
            }
            for(const angle of item.details.contentAngles??[])
              if(!valid(angle.evidenceRefs))throw Error('invalid news content evidence reference');
            const platforms=new Set((item.details.trendSignals??[]).map(signal=>signal.platform));
            const trendTags=new Set(item.details.trendTags??[]);
            if(item.details.trendSignals?.length&&platforms.size>=2&&!trendTags.has('cross_platform'))throw Error('invalid news trend tags');
            if(item.details.trendSignals?.length&&platforms.size===1&&!trendTags.has('single_platform'))throw Error('invalid news trend tags');
            if(trendTags.has('cross_platform')&&platforms.size<2||trendTags.has('single_platform')&&platforms.size!==1||trendTags.has('cross_platform')&&trendTags.has('single_platform'))throw Error('invalid news trend tags');
            if(trendTags.has('controversial')&&!item.details.publicDiscussion?.controversies?.length)throw Error('invalid news trend tags');
            if(trendTags.has('viral_video')&&!item.details.trendSignals?.some(signal=>signal.contentType==='video'))throw Error('invalid news trend tags');
            if(trendTags.has('sustained_discussion')){
              const repeated=(item.details.trendSignals??[]).some((signal,index,all)=>all.some((other,otherIndex)=>otherIndex!==index&&other.platform===signal.platform&&other.observedAt!==signal.observedAt));
              if(!repeated)throw Error('invalid news trend tags');
            }
            if(item.details.contentSuitability==='recommended'&&(!item.details.contentAngles?.length||!item.details.contentTags?.length||item.details.contentTags.includes('not_suitable')))throw Error('invalid news content assessment');
            if(item.details.contentSuitability==='not_recommended'&&(!!item.details.contentAngles?.length||!item.details.contentTags?.includes('not_suitable')))throw Error('invalid news content assessment');
          }
        }
      }
      rawReports.push(report);
    }
  }
  try {
    if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink())
      throw Error("invalid archive root");
    walk(root);
  } catch (e) {
    if (!(allowMissing && e.code === "ENOENT" && e.path === root)) throw e;
  }
  const reports = rawReports.map((report) => {
    const assigned = assignments.get(report.report_id);
    if (assigned && report.schema_version !== 1)
      throw Error("topic assignment only supports legacy archives");
    return {
      ...report,
      topic: report.topic ?? assigned ?? { id: "legacy", name: "历史简报" },
    };
  });
  const ids = new Set();
  for (const r of reports) {
    if (ids.has(r.report_id)) throw Error("duplicate report id");
    ids.add(r.report_id);
  }
  for (const id of assignments.keys())
    if (!ids.has(id)) throw Error("unknown topic assignment");
  reports.sort(
    (a, b) =>
      compare(b.report_date, a.report_date) ||
      b.version - a.version ||
      compare(a.topic.id, b.topic.id),
  );
  // Preserve the original public article URLs of legacy archives. New topic/source
  // pairs receive their own identity even when the canonical source is shared.
  const legacyOwners = new Map();
  for (const r of [...reports].reverse())
    if (r.schema_version === 1)
      for (const item of r.items)
        if (!legacyOwners.has(item.id)) legacyOwners.set(item.id, r.topic.id);
  const keyFor = (r, id) =>
    articleKey(
      id,
      legacyOwners.get(id) === r.topic.id ? undefined : r.topic.id,
    );
  const approvals = new Map();
  for (const r of reports)
    for (const item of r.items) {
      const key = keyFor(r, item.id),
        prior = approvals.get(key);
      if (!prior || Date.parse(r.approved_at) < Date.parse(prior))
        approvals.set(key, r.approved_at);
    }
  for (const r of reports)
    r.items = r.items.map((item) => ({
      ...item,
      key: keyFor(r, item.id),
      topic: r.topic,
      report_date: r.report_date,
      report_version: r.version,
      first_approved_at: approvals.get(keyFor(r, item.id)),
    }));
  const groups = new Map();
  for (const r of reports) {
    const key = `${r.topic.id}/${r.report_date}/${r.channel}`;
    if (!groups.has(key)) groups.set(key, r);
  }
  const latest = [...groups.values()],
    articles = new Map(),
    current = new Map();
  for (const r of [...reports].reverse())
    for (const item of r.items) articles.set(item.key, item);
  for (const r of [...latest].reverse())
    for (const item of r.items) current.set(item.key, item);
  for (const [key, item] of current) articles.set(key, item);
  const sort = (a, b) =>
    compare(b.report_date, a.report_date) ||
    b.importance - a.importance ||
    compare(a.key, b.key);
  const topicMap = new Map();
  for (const r of latest)
    if (!topicMap.has(r.topic.id))
      topicMap.set(r.topic.id, {
        ...r.topic,
        latest: r,
        reportCount: latest.filter((x) => x.topic.id === r.topic.id).length,
      });
  return {
    reports,
    latest,
    articles: [...articles.values()].sort(sort),
    current: [...current.values()].sort(sort),
    topics: [...topicMap.values()],
    demo: allowDemo,
  };
}
