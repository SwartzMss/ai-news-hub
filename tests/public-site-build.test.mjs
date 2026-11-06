import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { join } from "node:path";
import sax from "sax";
import { JSDOM } from "jsdom";
import { buildPublic } from "../apps/web/generator/build.mjs";
import { readArchives, articleKey } from "../apps/web/generator/data.mjs";
import { rss } from "../apps/web/generator/rss.mjs";
test("isolated static site contains all real routes, deterministic RSS and no admin/runtime artifacts", async () => {
  const result = await buildPublic({
    demo: true,
    siteUrl: "https://demo.invalid",
  });
  assert.equal(result.reports, 2);
  assert.equal(result.articles, 2);
  const root = result.output;
  for (const p of [
    "index.html",
    "channel/opensource/index.html",
    "archive/index.html",
    "archive/2026-11-02/index.html",
    "archive/2026-11-03/index.html",
    "archive/2026-11-03/opensource/v000001/index.html",
    "404.html",
  ])
    assert.ok(readFileSync(join(root, p), "utf8").includes("AI News Hub"));
  const data = readArchives("tests/fixtures/web-reports", { allowDemo: true });
  const homeDoc = new JSDOM(readFileSync(join(root, "index.html"), "utf8"))
    .window.document;
  const historyDoc = new JSDOM(
    readFileSync(join(root, "archive/index.html"), "utf8"),
  ).window.document;
  assert.equal(
    homeDoc.querySelector("main h1").textContent,
    data.latest[0].title,
  );
  assert.equal(historyDoc.querySelector("main h1").textContent, "往期简报");
  const text = homeDoc.body.textContent;
  for (const removed of [
    "静态阅读",
    "无需登录",
    "如何阅读",
    "把判断留给你",
    "每天发生很多事",
    "已已允许发布",
    "来源发布 未知",
  ])
    assert.ok(!text.includes(removed), removed);
  assert.ok(
    !historyDoc
      .querySelector("main")
      .textContent.includes(data.current[0].fact_summary),
    "archive lists editions instead of repeating article bodies",
  );
  const articleDoc = new JSDOM(
    readFileSync(join(root, `news/${data.current[0].key}/index.html`), "utf8"),
  ).window.document;
  assert.equal(
    articleDoc
      .querySelector('.site-nav a[href="/"]')
      .getAttribute("aria-current"),
    "page",
  );
  const feed = readFileSync(join(root, "rss/all.xml"), "utf8");
  assert.equal(feed, rss(data, "https://demo.invalid"));
  const ids = [];
  let inGuid = false;
  let count = 0;
  const parser = sax.parser(true, { strictEntities: true });
  parser.onopentag = (t) => {
    if (t.name === "guid") inGuid = true;
    if (t.name === "item") count++;
  };
  parser.ontext = (t) => {
    if (inGuid) ids.push(t);
  };
  parser.onclosetag = (n) => {
    if (n === "guid") inGuid = false;
  };
  parser.write(feed).close();
  assert.equal(count, 2);
  assert.equal(new Set(ids).size, 2);
  assert.equal(ids[0], "urn:ai-news-hub:article:" + data.current[0].key);
  assert.ok(
    readFileSync(
      join(root, `news/${data.current[0].key}/index.html`),
      "utf8",
    ).includes("来源事实摘要"),
  );
  function inspect(dir) {
    for (const f of readdirSync(dir)) {
      const path = join(dir, f);
      if (lstatSync(path).isDirectory()) {
        assert.ok(!["admin", "server", ".vite", "node_modules"].includes(f));
        inspect(path);
      } else {
        assert.ok(!/\.(?:db|sqlite|map|ts|tsx)$/.test(f));
        const text = readFileSync(path, "utf8");
        assert.ok(
          !/\/api\/(?:tasks|runs)|AI_NEWS_HUB_ADMIN_TOKEN|AI_NEWS_HUB_GITHUB_TOKEN/.test(
            text,
          ),
          path,
        );
      }
    }
  }
  inspect(root);
});
test("RSS XML escapes source and summary text and stable GUID survives revision updates", () => {
  const data = readArchives("tests/fixtures/web-reports", { allowDemo: true });
  const first = rss(data, "https://demo.invalid");
  data.current[0].fact_summary = 'A & B <script> "quoted"';
  data.current[0].report_version = 2;
  const second = rss(data, "https://demo.invalid");
  assert.match(second, /A &amp; B &lt;script&gt;/);
  assert.equal(
    first.match(/<guid[^>]*>([^<]+)/)[1],
    second.match(/<guid[^>]*>([^<]+)/)[1],
  );
});
test("RSS rejects XML 1.0 forbidden controls and isolated surrogates", () => {
  const data = readArchives("tests/fixtures/web-reports", { allowDemo: true });
  for (const bad of ["\u0001", "\u0000", "\ud800", "\ufffe"]) {
    data.current[0].fact_summary = bad;
    assert.throws(() => rss(data, "https://demo.invalid"), /XML/);
  }
});
test("production validates canonical origin and has an honest empty state without demo fallback", async () => {
  await assert.rejects(
    buildPublic({ siteUrl: "http://unsafe.example" }),
    /HTTPS/,
  );
  await assert.rejects(
    buildPublic({ siteUrl: "https://news.example/path" }),
    /HTTPS/,
  );
  const { mkdtempSync, rmSync } = await import("node:fs");
  const dir = mkdtempSync("/tmp/public-empty-");
  try {
    const result = await buildPublic({
      siteUrl: "https://news.example",
      reportsDir: dir,
    });
    assert.equal(result.demo, false);
    assert.equal(result.articles, 0);
    const html = readFileSync(join(result.output, "index.html"), "utf8");
    assert.match(html, /还没有已发布的日报/);
    assert.ok(!html.includes("演示 / 测试站点"));
    assert.ok(
      !readFileSync(join(result.output, "rss/all.xml"), "utf8").includes(
        "<item>",
      ),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("date and revision readers preserve exact archived text and separate current from past editions", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } =
    await import("node:fs");
  const dir = mkdtempSync("/tmp/public-reading-history-");
  try {
    const base = JSON.parse(
      readFileSync(
        "tests/fixtures/web-reports/2026/11/03/opensource/v000001.json",
        "utf8",
      ),
    );
    function save(doc) {
      const path = join(dir, ...doc.report_date.split("-"), "opensource");
      mkdirSync(path, { recursive: true });
      writeFileSync(
        join(path, `v${String(doc.version).padStart(6, "0")}.json`),
        JSON.stringify(doc),
      );
    }
    const older = {
      ...base,
      report_id: "past-first",
      title: "十一月二日原始日报",
      report_date: "2026-11-02",
      items: base.items.map((x) => ({
        ...x,
        fact_summary: "原始版本独有摘要；原始版本剩余正文。",
        analysis: "原始版本的分析。",
      })),
    };
    const withdrawn = {
      ...base.items[0],
      id: "withdrawn-article",
      fact_summary: "已从后续版本移除的条目。",
      source: {
        ...base.items[0].source,
        original_url: "https://example.com/withdrawn",
        canonical_url: "https://example.com/withdrawn",
      },
    };
    save({ ...older, items: [...older.items, withdrawn] });
    save({
      ...older,
      report_id: "past-revised",
      version: 2,
      title: "十一月二日修订日报",
      items: older.items.map((x) => ({
        ...x,
        fact_summary: "修订版本独有摘要；修订后的正文。",
        analysis: "修订版本的分析。",
      })),
    });
    save({
      ...base,
      report_id: "current-edition",
      title: "最新一期日报",
      items: base.items.map((x) => ({
        ...x,
        fact_summary: "最新一期独有摘要；最新一期正文。",
      })),
    });
    const built = await buildPublic({
      demo: true,
      siteUrl: "https://demo.invalid",
      reportsDir: dir,
    });
    const main = (path) =>
      new JSDOM(
        readFileSync(join(built.output, path), "utf8"),
      ).window.document.querySelector("main");
    const old = main("archive/2026-11-02/opensource/v000001/index.html");
    assert.ok(old.textContent.includes("原始版本独有摘要"));
    assert.ok(old.textContent.includes("原始版本的分析"));
    assert.ok(!old.textContent.includes("修订版本独有摘要"));
    assert.ok(!old.textContent.includes("最新一期独有摘要"));
    const revised = main("archive/2026-11-02/index.html");
    assert.ok(revised.textContent.includes("修订版本独有摘要"));
    assert.ok(revised.textContent.includes("往期简报"));
    assert.ok(!revised.textContent.includes("最新一期独有摘要"));
    const withdrawnDoc = new JSDOM(
      readFileSync(
        join(built.output, `news/${articleKey(withdrawn.id)}/index.html`),
        "utf8",
      ),
    ).window.document;
    assert.equal(
      withdrawnDoc.querySelector(".edition-links a").getAttribute("href"),
      "/archive/2026-11-02/opensource/v000001/",
    );
    const current = main("index.html");
    assert.equal(current.querySelector("h1").textContent, "最新一期日报");
    assert.ok(current.textContent.includes("最新一期独有摘要"));
    assert.ok(!current.textContent.includes("原始版本独有摘要"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
