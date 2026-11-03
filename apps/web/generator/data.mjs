import { validateTextTree } from "./text.mjs";
import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { createHash } from "node:crypto";
import { Ajv } from "ajv";
import addFormats from "ajv-formats";
const schema = JSON.parse(
  readFileSync(
    new URL(
      "../../../docs/schema/report-archive-v1.schema.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const ajv = new Ajv({
  strict: true,
  coerceTypes: false,
  removeAdditional: false,
});
addFormats(ajv);
const validate = ajv.compile(schema);
export const articleKey = (id) =>
  createHash("sha256").update(id).digest("hex").slice(0, 32);
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function safeUrl(raw) {
  const url = new URL(raw);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
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
  const reports = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      compare(a.name, b.name),
    )) {
      const file = join(dir, entry.name);
      const stat = lstatSync(file);
      if (stat.isSymbolicLink()) throw Error("archive symlinks forbidden");
      if (stat.isDirectory()) {
        if (relative(root, file).split("/").length > 4)
          throw Error("unexpected archive directory");
        walk(file);
        continue;
      }
      const name = relative(root, file);
      const match =
        /^(\d{4})\/(\d{2})\/(\d{2})\/opensource\/v(\d{6})\.json$/.exec(name);
      if (
        !match ||
        !stat.isFile() ||
        stat.size > 256 * 1024 ||
        ++entries > 10000
      )
        throw Error("unexpected archive file");
      const report = JSON.parse(readFileSync(file, "utf8"));
      validateTextTree(report);
      if (!validate(report)) throw Error("invalid archive schema: " + name);
      if (
        report.report_date !== match.slice(1, 4).join("-") ||
        report.version !== Number(match[4])
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
      }
      reports.push(report);
    }
  }
  try {
    if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink())
      throw Error("invalid archive root");
    walk(root);
  } catch (error) {
    if (!(allowMissing && error.code === "ENOENT" && error.path === root))
      throw error;
  }
  reports.sort(
    (a, b) => compare(b.report_date, a.report_date) || b.version - a.version,
  );
  const groups = new Map();
  const ids = new Set();
  for (const report of reports) {
    if (ids.has(report.report_id)) throw Error("duplicate report id");
    ids.add(report.report_id);
    const key = report.report_date + "/" + report.channel;
    if (!groups.has(key)) groups.set(key, report);
  }
  const latest = [...groups.values()];
  const articles = new Map();
  for (const report of [...reports].reverse()) {
    for (const item of report.items) {
      const key = articleKey(item.id);
      const prior = articles.get(key);
      articles.set(key, {
        ...item,
        key,
        report_date: report.report_date,
        report_version: report.version,
        first_approved_at: prior && Date.parse(prior.first_approved_at) < Date.parse(report.approved_at) ? prior.first_approved_at : report.approved_at,
      });
    }
  }
  const current = new Map();
  for (const report of [...latest].reverse())
    for (const item of report.items) {
      const key = articleKey(item.id);
      current.set(key, {
        ...item,
        key,
        report_date: report.report_date,
        report_version: report.version,
        first_approved_at: articles.get(key).first_approved_at,
      });
    }
  for (const [key, value] of current) articles.set(key, value);
  const sort = (a, b) =>
    compare(b.report_date, a.report_date) ||
    b.importance - a.importance ||
    compare(a.key, b.key);
  return {
    reports,
    latest,
    articles: [...articles.values()].sort(sort),
    current: [...current.values()].sort(sort),
    demo: allowDemo,
  };
}
