const timezone = "Asia/Shanghai";

export function searchCutoffDate(at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(at);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const cutoff = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
  cutoff.setUTCDate(cutoff.getUTCDate() - 29);
  return cutoff.toISOString().slice(0, 10);
}

function splitTitle(factSummary) {
  const text = typeof factSummary === "string" ? factSummary : "";
  const separator = text.search(/[。；\n]/u);
  return separator > 0
    ? { title: text.slice(0, separator), summary: text.slice(separator + 1).trim() }
    : { title: text, summary: "" };
}

export function buildSearchIndex(stories, { now = new Date() } = {}) {
  const cutoffDate = searchCutoffDate(now);
  const unique = new Map();
  for (const story of stories) {
    if (!story || typeof story.key !== "string" || typeof story.report_date !== "string" || story.report_date < cutoffDate) continue;
    const previous = unique.get(story.key);
    if (!previous || story.report_date > previous.report_date ||
      (story.report_date === previous.report_date && (story.report_version ?? 0) > (previous.report_version ?? 0))) {
      unique.set(story.key, story);
    }
  }
  const articles = [...unique.values()].map((story) => {
    const { title, summary } = splitTitle(story.fact_summary);
    return {
      key: story.key,
      topic_id: story.topic.id,
      topic_name: story.topic.name,
      report_date: story.report_date,
      title,
      summary,
      category: story.category,
      research_area: story.research_area ?? null,
      href: "/topics/" + story.topic.id + "/news/" + story.key + "/",
    };
  }).sort((a, b) => b.report_date.localeCompare(a.report_date) || a.title.localeCompare(b.title, "zh-CN") || a.key.localeCompare(b.key));
  return { schema_version: 1, cutoff_date: cutoffDate, articles };
}
