import { build } from "vite";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readArchives } from "./data.mjs";
import { rss, xml } from "./rss.mjs";
const repo = resolve(fileURLToPath(new URL("../../../", import.meta.url))),
  root = join(repo, "apps/web");
export async function buildPublic({
  demo = false,
  siteUrl = process.env.SITE_URL,
  reportsDir = process.env.PUBLIC_REPORTS_DIR,
  newsletterEnabled = process.env.NEWSLETTER_ENABLED === "1",
} = {}) {
  if (!siteUrl) throw Error("SITE_URL is required");
  const url = new URL(siteUrl);
  if (
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    (!demo && url.protocol !== "https:") ||
    !["http:", "https:"].includes(url.protocol)
  )
    throw Error("SITE_URL must be a canonical HTTPS origin");
  const source = reportsDir
    ? resolve(reportsDir)
    : join(repo, demo ? "tests/fixtures/web-reports" : "reports");
  const data = readArchives(source, {
    allowDemo: demo,
    allowMissing: !reportsDir && !demo,
  });
  data.newsletterEnabled = newsletterEnabled === true && !demo;
  const output = join(repo, "dist/web"),
    ssr = join(repo, "dist/web-render");
  const config = join(root, "vite.config.ts");
  await build({
    root,
    configFile: config,
    build: {
      outDir: output,
      emptyOutDir: true,
      manifest: true,
      rollupOptions: { input: join(root, "src/client.ts") },
    },
  });
  await build({
    root,
    configFile: config,
    build: {
      outDir: ssr,
      emptyOutDir: true,
      ssr: join(root, "src/render.tsx"),
      manifest: false,
      rollupOptions: { output: { entryFileNames: "render.mjs" } },
    },
  });
  const { render } = await import(pathToFileURL(join(ssr, "render.mjs")).href);
  const manifest = JSON.parse(
    readFileSync(join(output, ".vite/manifest.json"), "utf8"),
  );
  const entry = Object.values(manifest).find((x) => x.isEntry);
  if (!entry) throw Error("missing public client entry");
  const routes = [
    { kind: "home", path: "/" },
    { kind: "archive", path: "/archive/" },
    { kind: "channel", path: "/channel/opensource/", canonicalPath: "/" },
  ];
  const topicRoot = (id) => `/topics/${id}/`;
  const editionPath = (r, version = false) =>
    `${topicRoot(r.topic.id)}archive/${r.report_date}/${version ? `v${String(r.version).padStart(6, "0")}/` : ""}`;
  for (const topic of data.topics) {
    routes.push(
      { kind: "topic", path: topicRoot(topic.id), topicId: topic.id },
      {
        kind: "topicArchive",
        path: topicRoot(topic.id) + "archive/",
        topicId: topic.id,
      },
    );
  }
  for (const r of data.latest)
    routes.push({
      kind: "date",
      date: r.report_date,
      topicId: r.topic.id,
      path: editionPath(r),
    });
  for (const r of data.reports)
    routes.push({
      kind: "report",
      date: r.report_date,
      version: r.version,
      topicId: r.topic.id,
      path: editionPath(r, true),
    });
  for (const story of data.articles) {
    const path = topicRoot(story.topic.id) + `news/${story.key}/`;
    routes.push(
      { kind: "article", key: story.key, topicId: story.topic.id, path },
      {
        kind: "article",
        key: story.key,
        topicId: story.topic.id,
        path: `/news/${story.key}/`,
        canonicalPath: path,
      },
    );
  }
  const oldDates = new Set();
  for (const r of data.reports.filter((r) => r.schema_version === 1)) {
    if (!oldDates.has(r.report_date)) {
      oldDates.add(r.report_date);
      routes.push({
        kind: "date",
        date: r.report_date,
        topicId: r.topic.id,
        path: `/archive/${r.report_date}/`,
        canonicalPath: editionPath(r),
      });
    }
    routes.push({
      kind: "report",
      date: r.report_date,
      version: r.version,
      topicId: r.topic.id,
      path: `/archive/${r.report_date}/opensource/v${String(r.version).padStart(6, "0")}/`,
      canonicalPath: editionPath(r, true),
    });
  }
  function write(path, content) {
    const target = join(output, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  for (const page of [...routes, { kind: "404", path: "/404.html" }]) {
    const title =
      (data.demo ? "[DEMO] " : "") +
      "AI News Hub · " +
      ({
        home: "话题简报",
        topic: data.topics.find((t) => t.id === page.topicId)?.name,
        topicArchive:
          (data.topics.find((t) => t.id === page.topicId)?.name ?? "") +
          " · 往期简报",
        channel: "全部话题",
        archive: "话题归档",
        date: page.date,
        report: page.date + " 历史版本",
        article: data.articles
          .find((x) => x.key === page.key)
          ?.fact_summary.split(/[。；\n]/u)[0],
        404: "页面不存在",
      }[page.kind] ?? "阅读");
    const html =
      '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' +
      xml(title) +
      '</title><meta name="description" content="AI、开源项目与产业资讯，按日期整理的新闻简报。">' +
      (data.demo || page.kind === "404"
        ? '<meta name="robots" content="noindex,nofollow">'
        : "") +
      '<link rel="canonical" href="' +
      xml(new URL(page.canonicalPath ?? page.path, url).href) +
      '"><link rel="alternate" type="application/rss+xml" title="AI News Hub RSS" href="' +
      (page.topicId ? `/rss/topics/${page.topicId}.xml` : "/rss/all.xml") +
      '">' +
      (entry.css ?? [])
        .map((css) => '<link rel="stylesheet" href="/' + css + '">')
        .join("") +
      '<script type="module" src="/' +
      entry.file +
      '"></script></head><body>' +
      render(data, page) +
      "</body></html>\n";
    write(
      page.kind === "404" ? "404.html" : page.path.slice(1) + "index.html",
      html,
    );
  }
  write("rss/all.xml", rss(data, url.href));
  write("rss/opensource.xml", rss(data, url.href, "opensource"));
  for (const topic of data.topics)
    write(
      `rss/topics/${topic.id}.xml`,
      rss(data, url.href, undefined, topic.id),
    );
  write(
    "data/index.json",
    JSON.stringify({
      schema_version: 1,
      demo: data.demo,
      ...(data.newsletterEnabled ? { newsletterEnabled: true } : {}),
      topics: data.topics,
      reports: data.latest,
      articles: data.current,
    }) + "\n",
  );
  write(
    "sitemap.xml",
    '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      routes
        .filter((p) => !p.canonicalPath)
        .map(
          (p) => "<url><loc>" + xml(new URL(p.path, url).href) + "</loc></url>",
        )
        .join("") +
      "</urlset>\n",
  );
  write(
    "robots.txt",
    data.demo
      ? "User-agent: *\nDisallow: /\n"
      : "User-agent: *\nAllow: /\nSitemap: " +
          new URL("/sitemap.xml", url).href +
          "\n",
  );
  write(
    "_headers",
    `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: ${data.newsletterEnabled ? "strict-origin" : "no-referrer"}\n  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; connect-src '${data.newsletterEnabled ? "self" : "none"}'; form-action 'self'\n/rss/*\n  Content-Type: application/rss+xml; charset=utf-8\n/data/*\n  Content-Type: application/json; charset=utf-8\n`,
  );
  rmSync(join(output, ".vite"), { recursive: true, force: true });
  return {
    output,
    routes: routes.length,
    reports: data.reports.length,
    articles: data.current.length,
    demo,
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const demo = process.argv.includes("--demo");
  console.log(
    JSON.stringify(
      await buildPublic({
        demo,
        siteUrl:
          process.env.SITE_URL ?? (demo ? "https://demo.invalid" : undefined),
      }),
    ),
  );
}
