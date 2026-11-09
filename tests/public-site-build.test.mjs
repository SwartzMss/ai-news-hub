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
    new Intl.DateTimeFormat("zh-CN", {year:"numeric",month:"long",day:"numeric",timeZone:"UTC"}).format(new Date(data.topics[0].latest.report_date + "T00:00:00Z")),
  );
  assert.equal(historyDoc.querySelector("main h1").textContent, "话题归档");
  assert.equal(historyDoc.querySelector("footer"), null);
  assert.equal(homeDoc.querySelectorAll(".topic-issue-heading, .topic-panel-header, .news-footer, .news-row .news-number").length, 0);
  assert.equal(homeDoc.querySelectorAll(".brief-heading").length, data.topics.length);
  assert.equal(homeDoc.querySelector("footer"), null);
  assert.equal(homeDoc.querySelectorAll(".brief-edition-top, .brief-topic").length, 0);
  assert.ok(homeDoc.querySelector(".reader-body.has-topics > .topic-picker"));
  assert.ok(homeDoc.querySelector(".reader-body > main"));
  assert.equal(homeDoc.querySelectorAll(".brief-toc").length,data.topics.length);
  for(const panel of homeDoc.querySelectorAll("[data-topic-panel]")){
    assert.ok(panel.querySelector(".brief-heading > .brief-date:first-child"));
    const links=panel.querySelectorAll(".brief-toc a[data-brief-target]");
    assert.equal(links.length,panel.querySelectorAll(".news-row").length);
    for(const link of links) assert.ok(panel.querySelector(`[id="${link.dataset.briefTarget}"]`));
    assert.ok(panel.querySelector(".brief-generation time[datetime]"));
    assert.equal(panel.querySelector(".brief-date time").getAttribute("datetime"),data.topics.find(t=>t.id===panel.dataset.topicPanel).latest.report_date);
  }
  assert.ok(homeDoc.querySelector(".news-row h2 a[href*='/news/']"));
  assert.ok(homeDoc.querySelector(".news-row .news-meta a[target='_blank']"));
  assert.ok(!homeDoc.querySelector("main").textContent.includes("进入话题"));
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
  assert.equal(articleDoc.querySelector("footer"), null);
  assert.equal(
    articleDoc
      .querySelector('.site-nav a[href="/"]')
      .getAttribute("aria-current"),
    "page",
  );
  assert.equal(articleDoc.querySelector(".article-header time"), null);
  assert.ok(articleDoc.querySelector(".article-header .category-label"));
  assert.equal(articleDoc.querySelectorAll(".breadcrumb a").length, 2);
  assert.ok(articleDoc.querySelector(".breadcrumb a:last-child").getAttribute("href").includes(data.current[0].report_date));
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
      "/topics/legacy/archive/2026-11-02/v000001/",
    );
    const current = main("topics/legacy/index.html");
    assert.equal(current.querySelector(".brief-topic"), null);
    assert.ok(current.querySelector(".brief-heading > .brief-date:first-child"));
    assert.equal(current.querySelector(".brief-date time").getAttribute("datetime"), base.report_date);
    assert.ok(!current.textContent.includes("最新一期日报"));
    assert.ok(current.textContent.includes("最新一期独有摘要"));
    assert.ok(!current.textContent.includes("原始版本独有摘要"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("topic routes, editions, browser selection and RSS isolate shared sources across topics", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const dir = mkdtempSync("/tmp/public-topic-reading-");
  const a = { id: "t-" + "a".repeat(24), name: "模型进展" };
  const b = { id: "t-" + "b".repeat(24), name: "开源工具" };
  const base = JSON.parse(readFileSync("tests/fixtures/web-reports/2026/11/03/opensource/v000001.json", "utf8"));
  const save = (doc) => {
    const path = doc.schema_version === 1
      ? join(dir, ...doc.report_date.split("-"), "opensource")
      : join(dir, "topics", doc.topic.id, ...doc.report_date.split("-"));
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, `v${String(doc.version).padStart(6, "0")}.json`), JSON.stringify(doc));
  };
  try {
    save({ ...base, report_id: "legacy-a", title: "甲话题原版",
      items: base.items.map((item) => ({ ...item, fact_summary: "甲话题原始事实；原始正文。" })) });
    writeFileSync(join(dir, "topics.json"), JSON.stringify({ schema_version: 1,
      assignments: [{ report_id: "legacy-a", topic: a }] }));
    save({ ...base, schema_version: 2, topic: a, version: 2, report_id: "a-revised", title: "甲话题修订版",
      items: base.items.map((item) => ({ ...item, fact_summary: "甲话题最新事实；甲专属正文。" })) });
    save({ ...base, schema_version: 2, topic: b, report_id: "b-current", title: "乙话题日报",
      items: base.items.map((item) => ({ ...item, fact_summary: "乙话题最新事实；乙专属正文。" })) });
    const built = await buildPublic({ demo: true, siteUrl: "https://demo.invalid", reportsDir: dir });
    const read = (path) => readFileSync(join(built.output, path), "utf8");
    const documentAt = (path) => new JSDOM(read(path)).window.document;
    const mainAt = (path) => documentAt(path).querySelector("main");
    const home = documentAt("index.html");
    assert.equal(home.querySelectorAll("[data-topic-panel]").length, 2);
    assert.equal(home.querySelectorAll("[data-topic-panel]:not([hidden])").length, 1);
    for (const topic of [a, b]) {
      assert.ok(home.querySelector(`a[data-topic-choice="${topic.id}"][href="/topics/${topic.id}/"]`));
      assert.ok(documentAt("archive/index.html").querySelector(`main a[href="/topics/${topic.id}/archive/"]`));
      assert.equal(documentAt(`topics/${topic.id}/index.html`).querySelector("footer"), null);
      assert.equal(documentAt(`topics/${topic.id}/index.html`).querySelector('link[rel="alternate"]').getAttribute("href"), `/rss/topics/${topic.id}.xml`);
    }
    const aMain = mainAt(`topics/${a.id}/archive/2026-11-03/index.html`);
    assert.match(aMain.textContent, /甲话题最新事实/);
    assert.doesNotMatch(aMain.textContent, /乙话题最新事实|甲话题原始事实/);
    assert.equal(aMain.querySelectorAll('.revision-list a').length, 2);
    const old = mainAt(`topics/${a.id}/archive/2026-11-03/v000001/index.html`);
    assert.match(old.textContent, /甲话题原始事实/);
    assert.doesNotMatch(old.textContent, /甲话题最新事实|乙话题最新事实/);
    assert.match(mainAt(`topics/${a.id}/archive/2026-11-03/v000002/index.html`).textContent, /甲话题最新事实/);
    const bMain = mainAt(`topics/${b.id}/archive/2026-11-03/v000001/index.html`);
    assert.match(bMain.textContent, /乙话题最新事实/);
    assert.doesNotMatch(bMain.textContent, /甲话题|修订记录/);
    assert.match(mainAt("archive/2026-11-03/opensource/v000001/index.html").textContent, /甲话题原始事实/);
    assert.equal(documentAt("archive/2026-11-03/index.html").querySelector('link[rel="canonical"]').href,
      `https://demo.invalid/topics/${a.id}/archive/2026-11-03/`);
    const key = articleKey(base.items[0].id);
    const bKey = articleKey(base.items[0].id, b.id);
    assert.match(mainAt(`news/${key}/index.html`).textContent, /甲话题最新事实/);
    assert.match(mainAt(`topics/${b.id}/news/${bKey}/index.html`).textContent, /乙话题最新事实/);
    const feedA = read(`rss/topics/${a.id}.xml`), feedB = read(`rss/topics/${b.id}.xml`);
    assert.match(feedA, /甲话题最新事实/);
    assert.doesNotMatch(feedA, /乙话题最新事实|甲话题原始事实/);
    assert.match(feedB, /乙话题最新事实/);
    assert.doesNotMatch(feedB, /甲话题最新事实/);
    const parseFeed = (feed) => new JSDOM(feed, { contentType: "application/xml" }).window.document;
    assert.equal(parseFeed(feedA).querySelectorAll("item").length, 1);
    assert.equal(parseFeed(feedB).querySelectorAll("item").length, 1);
    assert.equal(parseFeed(feedA).querySelector("guid").textContent, `urn:ai-news-hub:article:${key}`);
    assert.equal(parseFeed(feedB).querySelector("guid").textContent, `urn:ai-news-hub:article:${bKey}`);
    const browser = new JSDOM(read("index.html"), { url: `https://demo.invalid/?topic=${b.id}`, runScripts: "outside-only" });
    browser.window.matchMedia = () => ({ matches: false });
    const client = read(browser.window.document.querySelector('script[type="module"]').getAttribute("src").slice(1));
    browser.window.eval(client);
    const visible = () => browser.window.document.querySelectorAll("[data-topic-panel]:not([hidden])");
    assert.equal(visible().length, 1);
    assert.equal(visible()[0].dataset.topicPanel, b.id);
    assert.equal(browser.window.localStorage.getItem("news-hub-topic"), b.id);
    const choice = browser.window.document.querySelector(`a[data-topic-choice="${a.id}"]`);
    choice.dispatchEvent(new browser.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    assert.equal(visible().length, 1);
    assert.equal(visible()[0].dataset.topicPanel, a.id);
    assert.equal(new URL(browser.window.location.href).searchParams.get("topic"), a.id);
    const tocLink = visible()[0].querySelector(".brief-toc a[data-brief-target]");
    tocLink.dispatchEvent(new browser.window.MouseEvent("click", {bubbles:true,cancelable:true,button:0}));
    assert.equal(tocLink.getAttribute("aria-current"), "location");
    assert.equal(visible()[0].querySelector(".brief-toc time"), null);
    assert.equal(visible()[0].querySelector(".brief-toc .brief-topic"), null);

    assert.equal(browser.window.document.querySelector("footer"), null);
    assert.equal(browser.window.document.querySelector("[data-topic-archive]").getAttribute("href"), `/topics/${a.id}/archive/`);
    browser.window.history.replaceState(null, "", `/?topic=${b.id}`);
    browser.window.dispatchEvent(new browser.window.PopStateEvent("popstate"));
    assert.equal(visible()[0].dataset.topicPanel, b.id);
    browser.window.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("reading previews render explicit source links without executing markup or changing archives", async () => {
  const {mkdtempSync,mkdirSync,writeFileSync,rmSync}=await import('node:fs');
  const dir=mkdtempSync('/tmp/public-inline-text-');
  try {
    const report=JSON.parse(readFileSync('tests/fixtures/web-reports/2026/11/03/opensource/v000001.json','utf8'));
    report.items=report.items.slice(0,1).map(item=>({...item,fact_summary:'一条完整的标题。参考[官方公告](https://example.com/release)与[不安全地址](javascript:alert(1))、[带凭据地址](https://user:secret@example.com/private)，<img src=x onerror=alert(1)>。'}));
    const folder=join(dir,...report.report_date.split('-'),'opensource');mkdirSync(folder,{recursive:true});
    const file=join(folder,'v000001.json'),bytes=JSON.stringify(report);writeFileSync(file,bytes);
    const built=await buildPublic({demo:true,siteUrl:'https://demo.invalid',reportsDir:dir});
    for(const path of ['index.html',`topics/legacy/news/${articleKey(report.items[0].id)}/index.html`]) {
      const doc=new JSDOM(readFileSync(join(built.output,path),'utf8')).window.document;
      const content=doc.querySelector('main');
      const link=content.querySelector('a[href="https://example.com/release"]');
      assert.equal(link.textContent,'官方公告');assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener noreferrer');
      assert.ok(!content.textContent.includes('[官方公告]('));
      assert.equal(content.querySelectorAll('img, script').length,0);
      assert.equal(content.querySelectorAll('a[href^="javascript:"], a[href*="user:secret"]').length,0);
      assert.ok(content.textContent.includes('<img src=x onerror=alert(1)>'));
    }
    assert.equal(readFileSync(file,'utf8'),bytes);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test("project detail presents verified fields as readable sections", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const dir = mkdtempSync("/tmp/public-project-detail-");
  try {
    const report = JSON.parse(readFileSync("tests/fixtures/web-reports/2026/11/03/opensource/v000001.json", "utf8"));
    report.items = report.items.slice(0, 1);
    report.items[0].fact_summary = "Mesh LLM 发布分布式推理系统。官方【新发布】；用途：把多台电脑组成推理网络；技术要点：Rust 服务通过 QUIC 连接节点；按模型阶段分配计算；近期证据：官方仓库公开了代码；适用场景：多机推理实验；许可证：Apache-2.0。[项目仓库](https://github.com/example/mesh-llm)";
    report.items[0].analysis = "推荐理由：便于研究异构设备的推理调度；限制：需要自行验证性能。";
    report.items.push({ ...report.items[0], id: "related-project", fact_summary: "Sandcastle 发布隔离 Agent 环境。用途：并行运行开发任务；技术要点：通过容器隔离工作区；近期证据：官方发布新版本；适用场景：多 Agent 开发；许可证：MIT。[项目仓库](https://github.com/example/sandcastle)" });
    const folder = join(dir, ...report.report_date.split("-"), "opensource");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "v000001.json"), JSON.stringify(report));
    const built = await buildPublic({ demo: true, siteUrl: "https://demo.invalid", reportsDir: dir });
    const key = articleKey(report.items[0].id);
    const doc = new JSDOM(readFileSync(join(built.output, `topics/legacy/news/${key}/index.html`), "utf8")).window.document;
    assert.equal(doc.querySelector(".project-detail h1").textContent, "Mesh LLM");
    assert.equal(doc.querySelector(".project-detail .project-subtitle").textContent, "Mesh LLM 发布分布式推理系统");
    assert.equal(doc.querySelector(".project-detail .project-repository").getAttribute("href"), "https://github.com/example/mesh-llm");
    assert.equal(doc.querySelector(".reading-aside"), null);
    assert.ok(doc.querySelector(".reading-layout.project-layout > main > .project-detail"));
    assert.ok(doc.querySelector(".reader-body.has-topics > .topic-picker"));
    assert.ok(doc.querySelector(".project-aside nav[aria-label='本文目录'] a[href='#project-fact-0']"));
    assert.ok(doc.querySelector("#project-fact-0"));
    assert.equal(doc.querySelectorAll(".project-related a").length, 1);
    assert.equal(doc.querySelector(".breadcrumb a:first-child").textContent, "历史简报");
    for (const heading of ["核心用途", "技术要点", "近期关注原因", "适用场景", "许可证", "推荐理由", "限制"])
      assert.ok([...doc.querySelectorAll(".project-detail h2")].some((h) => h.textContent === heading), heading);
    assert.equal(doc.querySelectorAll(".project-detail .project-technical li").length, 2);
    assert.equal(doc.querySelectorAll(".project-detail a[href=\"https://github.com/example/mesh-llm\"]").length, 1);
    assert.ok(doc.querySelector(".project-detail .source-details"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('investment detail renders evidence-linked metrics and a section directory',async()=>{
 const {mkdtempSync,mkdirSync,writeFileSync,rmSync}=await import('node:fs');
 const dir=mkdtempSync('/tmp/public-investment-detail-');
 try{
  const report=JSON.parse(readFileSync('tests/fixtures/web-reports/2026/11/03/opensource/v000001.json','utf8'));
  report.items=report.items.slice(0,1);
  report.items[0].details={kind:'investment',background:'公司发布季度业绩。',metrics:[{name:'季度收入',value:'12.4',unit:'亿美元',period:'2026 Q3',comparison:'同比增长 8%',basis:'actual',evidenceRefs:['filing']}],supplyChain:[{segment:'服务器内存',direction:'需求可能增加',reason:'单机配置提高',relationship:'potential'}],investmentLogic:'订单兑现后可能影响收入。',watchpoints:['订单交付'],risks:['客户认证推迟'],evidence:[{id:'filing',name:'季度财报',url:'https://example.com/filing',supports:'季度收入实际值'}]};
  const folder=join(dir,...report.report_date.split('-'),'opensource');mkdirSync(folder,{recursive:true});writeFileSync(join(folder,'v000001.json'),JSON.stringify(report));
  const built=await buildPublic({demo:true,siteUrl:'https://demo.invalid',reportsDir:dir});
  const doc=new JSDOM(readFileSync(join(built.output,`topics/legacy/news/${articleKey(report.items[0].id)}/index.html`),'utf8')).window.document;
  assert.ok(doc.querySelector('.investment-detail'));
  assert.match(doc.querySelector('.investment-detail table').textContent,/季度收入.*12.4.*实际值/s);
  assert.match(doc.querySelector('.investment-detail').textContent,/潜在影响|潜在关系/);
  assert.ok(doc.querySelector('.investment-detail a[href="https://example.com/filing"]'));
  assert.ok(doc.querySelector('.investment-aside a[href="#investment-metrics"]'));
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test("newsletter is opt-in, works as a native POST form and keeps email out of storage and URLs", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const dir = mkdtempSync("/tmp/public-newsletter-");
  try {
    const disabled = await buildPublic({ siteUrl: "https://news.example", reportsDir: dir, newsletterEnabled: false });
    assert.doesNotMatch(readFileSync(join(disabled.output, "index.html"), "utf8"), /newsletter-signup/);
    assert.match(readFileSync(join(disabled.output, "_headers"), "utf8"), /connect-src 'none'/);
    const enabled = await buildPublic({ siteUrl: "https://news.example", reportsDir: dir, newsletterEnabled: true });
    const html = readFileSync(join(enabled.output, "index.html"), "utf8");
    const browser = new JSDOM(html, { url: "https://news.example/", runScripts: "outside-only" });
    const { window } = browser;
    window.matchMedia = () => ({ matches: false });
    const form = window.document.querySelector("#newsletter-signup form");
    assert.ok(form, "enabled build has a signup form");
    assert.equal(form.getAttribute("method"), "post");
    assert.equal(form.getAttribute("action"), "/api/newsletter/subscribe");
    assert.equal(form.querySelector('[name="email"]').type, "email");
    assert.ok(form.querySelector('[name="email"]').required);
    assert.equal(form.querySelector('[name="website"]').tabIndex, -1);
    assert.equal(window.document.querySelector(".header-actions a"), null);
    assert.equal(window.document.querySelector("footer"), null);
    assert.ok(window.document.querySelector(".site-shell > #newsletter-signup"));
    assert.equal(window.document.querySelector(".topic-picker #newsletter-signup, .brief-toc #newsletter-signup"), null);
    assert.match(readFileSync(join(enabled.output, "_headers"), "utf8"), /connect-src 'self'/);
    assert.match(readFileSync(join(enabled.output, "_headers"), "utf8"), /Referrer-Policy: strict-origin/);
    assert.equal(JSON.parse(readFileSync(join(enabled.output, "data/index.json"), "utf8")).newsletterEnabled, true);
    assert.doesNotMatch(html, /RESEND_API_KEY|NEWSLETTER_TOKEN_SECRET/);
    const client = readFileSync(join(enabled.output, window.document.querySelector('script[type="module"]').getAttribute("src").slice(1)), "utf8");
    let complete;
    const calls = [];
    window.fetch = (...args) => {
      calls.push(args);
      return new Promise((resolve) => { complete = resolve; });
    };
    window.eval(client);
    const email = form.querySelector('[name="email"]');
    const submit = form.querySelector('button[type="submit"]');
    const status = form.querySelector('[role="status"]');
    const send = () => form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    email.value = "reader@example.com";
    send(); send();
    assert.equal(calls.length, 1);
    assert.equal(submit.disabled, true);
    assert.equal(calls[0][0], "/api/newsletter/subscribe");
    assert.equal(calls[0][1].method, "POST");
    assert.equal(calls[0][1].headers.Accept, "application/json");
    assert.deepEqual(JSON.parse(calls[0][1].body), { email: "reader@example.com", website: "" });
    complete({ status: 429 }); await settle();
    assert.match(status.textContent, /频繁/);
    assert.equal(submit.disabled, false);
    send(); complete({ status: 503 }); await settle();
    assert.match(status.textContent, /暂不可用/);
    send(); complete({ status: 202 }); await settle();
    assert.match(status.textContent, /确认/);
    assert.equal(email.value, "");
    assert.doesNotMatch(window.location.href + JSON.stringify(window.localStorage), /reader@/);
    browser.window.close();
    const demo = await buildPublic({ demo: true, siteUrl: "https://demo.invalid", newsletterEnabled: true });
    assert.doesNotMatch(readFileSync(join(demo.output, "index.html"), "utf8"), /newsletter-signup/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
