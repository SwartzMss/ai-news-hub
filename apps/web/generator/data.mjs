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
const validateArchive = ajv.compile(readSchema("report-archive-v1.schema.json"));
export const articleKey = (id, topicId) => {
  if (!/^t-[a-f0-9]{24}$/.test(topicId ?? "")) throw Error("invalid article topic");
  return createHash("sha256").update(`${topicId}:${id}`).digest("hex").slice(0, 32);
};
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
  const rawReports = [];
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
      const scoped =
        /^topics\/(t-[a-f0-9]{24})\/(\d{4})\/(\d{2})\/(\d{2})\/v(\d{6})\.json$/.exec(name);
      if (!scoped || ++entries > 10000)
        throw Error("unexpected archive file");
      const report = JSON.parse(readFileSync(file, "utf8"));
      validateTextTree(report);
      if (!validateArchive(report))
        throw Error("invalid archive schema: " + name);
      if (
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
        const evidenceIds=new Set();
        for(const evidence of item.details.evidence){
          if(evidenceIds.has(evidence.id)||new URL(evidence.url).protocol!=='https:')throw Error('invalid public evidence');
          evidenceIds.add(evidence.id);
          safeUrl(evidence.url);
        }
        const validateEvidenceRefs=value=>{
          if(Array.isArray(value)){for(const entry of value)validateEvidenceRefs(entry);return;}
          if(!value||typeof value!=='object')return;
          for(const [key,entry] of Object.entries(value)){
            if(key==='evidenceRefs'&&Array.isArray(entry)&&entry.some(id=>!evidenceIds.has(id)))throw Error('invalid public evidence reference');
            validateEvidenceRefs(entry);
          }
        };
        validateEvidenceRefs(item.details);
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
  const reports = rawReports;
  const ids = new Set();
  for (const r of reports) {
    if (ids.has(r.report_id)) throw Error("duplicate report id");
    ids.add(r.report_id);
  }
  reports.sort(
    (a, b) =>
      compare(b.report_date, a.report_date) ||
      b.version - a.version ||
      compare(a.topic.id, b.topic.id),
  );
  const keyFor = (r, id) => articleKey(id, r.topic.id);
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
