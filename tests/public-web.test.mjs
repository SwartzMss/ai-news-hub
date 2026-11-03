import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { readArchives } from "../apps/web/generator/data.mjs";
import { ARCHIVE_SCHEMA } from "../dist/apps/server/src/publish/archive-schema.js";
import { publicationFixture } from "./fixtures/publication.mjs";
import {
  archiveArtifact,
  reviewedReport,
} from "../dist/apps/server/src/publish/artifact.js";
function setup() {
  const dir = mkdtempSync("/tmp/web-archive-");
  const f = publicationFixture();
  const doc = JSON.parse(
    archiveArtifact(reviewedReport(f.db, "r"), "2026-11-03T01:00:00Z").content,
  );
  f.close();
  function save(d) {
    const p = `${dir}/${d.report_date.replaceAll("-", "/")}/${d.channel}`;
    mkdirSync(p, { recursive: true });
    writeFileSync(
      `${p}/v${String(d.version).padStart(6, "0")}.json`,
      JSON.stringify(d),
    );
  }
  return {
    dir,
    doc,
    save,
    close() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("public loader preserves history and chooses latest revision deterministically", () => {
  const s = setup();
  try {
    s.save(s.doc);
    s.save({ ...s.doc, report_id: "r2", version: 2, title: "revised" });
    s.save({ ...s.doc, report_id: "r3", report_date: "2026-11-04" });
    const data = readArchives(s.dir, { allowDemo: true });
    assert.equal(data.reports.length, 3);
    assert.equal(data.latest.length, 2);
    assert.equal(
      data.latest.find((r) => r.report_date === "2026-11-03").title,
      "revised",
    );
    assert.equal(data.articles.length, 1);
  } finally {
    s.close();
  }
});
test("public build refuses malformed contracts, unsafe source URLs and path mismatch", () => {
  for (const change of [
    { review_status: "pending" },
    { schema_version: 99 },
    { run_id: "private" },
    { report_date: "2026-99-99" },
    { items: [] },
  ]) {
    const s = setup();
    try {
      s.save({ ...s.doc, ...change });
      assert.throws(() => readArchives(s.dir, { allowDemo: true }));
    } finally {
      s.close();
    }
  }
  const s = setup();
  try {
    s.doc.items[0].source.canonical_url = "javascript:alert(1)";
    s.save(s.doc);
    assert.throws(() => readArchives(s.dir, { allowDemo: true }));
  } finally {
    s.close();
  }
  assert.equal(ARCHIVE_SCHEMA.properties.review_status.const, "approved");
});
test("production never silently accepts demo data or a symlink", async () => {
  const s = setup();
  try {
    s.save(s.doc);
    assert.throws(() => readArchives(s.dir), /test report/);
    const { symlinkSync } = await import("node:fs");
    symlinkSync(s.dir + "/2026", s.dir + "/link");
    assert.throws(() => readArchives(s.dir, { allowDemo: true }), /symlink/);
  } finally {
    s.close();
  }
});
test("removed revision entries remain historical but do not replace current older-date content", () => {
  const s = setup();
  try {
    const source = s.doc.items[0];
    s.save({
      ...s.doc,
      report_date: "2026-11-02",
      report_id: "old",
      items: [{ ...source, fact_summary: "Old current content" }],
    });
    s.save({
      ...s.doc,
      report_id: "before",
      items: [{ ...source, fact_summary: "Withdrawn content" }],
    });
    s.save({
      ...s.doc,
      version: 2,
      report_id: "after",
      items: [{ ...source, id: "different", fact_summary: "Replacement" }],
    });
    const data = readArchives(s.dir, { allowDemo: true });
    assert.equal(
      data.current.find((x) => x.id === source.id).fact_summary,
      "Old current content",
    );
    assert.equal(
      data.current.find((x) => x.id === source.id).report_date,
      "2026-11-02",
    );
    assert.equal(
      data.reports.find((x) => x.report_id === "before").items[0].fact_summary,
      "Withdrawn content",
    );
  } finally {
    s.close();
  }
});
test('Linux archive paths cannot be disguised by backslashes in a filename',()=>{
 const s=setup();try{writeFileSync(s.dir+'/2026\\11\\03\\opensource\\v000001.json',JSON.stringify(s.doc));assert.throws(()=>readArchives(s.dir,{allowDemo:true}),/unexpected archive file/);}finally{s.close();}
});
