import { xml } from "./text.mjs";
export { xml } from "./text.mjs";
export function rss(data, siteUrl, channel) {
  const base = new URL(siteUrl);
  const feed = channel ? "/rss/opensource.xml" : "/rss/all.xml";
  const title =
    (data.demo ? "[DEMO] " : "") +
    "AI News Hub" +
    (channel ? " · 资讯更新" : "");
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>' +
    xml(title) +
    "</title><link>" +
    xml(base.href) +
    "</link><description>" +
    xml(
      data.demo
        ? "演示与测试 RSS，不作为正式新闻发布。"
        : "按日期归档的 AI、开源项目与产业简报。",
    ) +
    '</description><language>zh-CN</language><atom:link href="' +
    xml(new URL(feed, base).href) +
    '" rel="self" type="application/rss+xml"/>' +
    data.current
      .slice(0, 100)
      .map((item) => {
        const description = `${data.demo ? "[DEMO / 测试内容]\n" : ""}来源事实摘要：${item.fact_summary}\n分析（推断）：${item.analysis ?? "无"}\n依据引文：${item.evidence_quote}\n原文：${item.source.canonical_url}\n来源发布时间：${item.source.published_at ?? "未知"}；事件时间：${item.source.event_at ?? "未知"}${item.source.fetched_at ? `；抓取：${item.source.fetched_at}` : ""}\n${item.verification === "codex_reported" ? "来源由 Codex 提供" : "来源记录"}。`;
        return (
          "<item><title>" +
          xml(item.evidence_quote) +
          "</title><link>" +
          xml(new URL("/news/" + item.key + "/", base).href) +
          '</link><guid isPermaLink="false">urn:ai-news-hub:article:' +
          item.key +
          "</guid><pubDate>" +
          new Date(item.first_approved_at).toUTCString() +
          "</pubDate><description>" +
          xml(description) +
          "</description></item>"
        );
      })
      .join("") +
    "</channel></rss>\n"
  );
}
