import { categories, researchAreaLabels } from "./ReadingParts";

type SearchArticle = {
  key: string; topic_id: string; topic_name: string; report_date: string;
  title: string; summary: string; category: string; research_area: string | null; href: string;
};
type SearchIndex = { schema_version: number; articles: SearchArticle[] };

function normalize(value: string) {
  return value.toLocaleLowerCase("zh-CN").replace(/\s+/gu, " ").trim();
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" })
    .format(new Date(value + "T00:00:00Z"));
}

export function mountSiteSearch() {
  const form = document.querySelector<HTMLFormElement>("[data-site-search-form]");
  if (!form) return;
  const input = form.querySelector<HTMLInputElement>("[data-search-input]");
  const status = document.querySelector<HTMLElement>("[data-search-status]");
  const results = document.querySelector<HTMLOListElement>("[data-search-results]");
  if (!input || !status || !results) return;

  let indexPromise: Promise<SearchIndex> | undefined;
  let requestVersion = 0;
  const loadIndex = () => {
    indexPromise ??= fetch("/data/search-index.json", { credentials: "omit", headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error("search index request failed");
        const value = await response.json() as Partial<SearchIndex>;
        if (!Array.isArray(value.articles)) throw new Error("invalid search index");
        return value as SearchIndex;
      });
    return indexPromise;
  };
  const appendEmpty = (message: string) => {
    const item = document.createElement("li");
    item.className = "search-empty";
    item.textContent = message;
    results.replaceChildren(item);
  };
  const render = (articles: SearchArticle[]) => {
    const nodes = articles.map((article) => {
      const item = document.createElement("li");
      item.className = "search-result";
      const heading = document.createElement("h2");
      const link = document.createElement("a");
      link.href = article.href;
      link.textContent = article.title;
      heading.append(link);
      item.append(heading);
      if (article.summary) {
        const summary = document.createElement("p");
        summary.className = "search-result-summary";
        summary.textContent = article.summary;
        item.append(summary);
      }
      const meta = document.createElement("div");
      meta.className = "search-result-meta";
      const topic = document.createElement("span");
      topic.className = "search-result-topic";
      topic.textContent = article.topic_name;
      const date = document.createElement("time");
      date.dateTime = article.report_date;
      date.textContent = dateLabel(article.report_date);
      const category = document.createElement("span");
      category.className = "search-result-category";
      category.textContent = article.research_area
        ? (researchAreaLabels[article.research_area as keyof typeof researchAreaLabels] ?? article.research_area)
        : (categories[article.category] ?? article.category);
      meta.append(topic, date, category);
      item.append(meta);
      return item;
    });
    results.replaceChildren(...nodes);
  };
  const runSearch = async (rawQuery: string) => {
    const version = ++requestVersion;
    const query = normalize(rawQuery);
    if (!query) {
      status.textContent = "输入关键词开始搜索。";
      results.replaceChildren();
      return;
    }
    status.textContent = "正在搜索…";
    results.replaceChildren();
    try {
      const index = await loadIndex();
      if (version !== requestVersion) return;
      if (!index.articles.length) {
        status.textContent = "最近 30 天内暂无可搜索文章。";
        return;
      }
      const terms = query.split(" ").filter(Boolean);
      const matched = index.articles.filter((article) => {
        const researchLabel = article.research_area
          ? researchAreaLabels[article.research_area as keyof typeof researchAreaLabels] ?? article.research_area
          : "";
        const categoryLabel = categories[article.category] ?? article.category;
        const searchable = normalize([
          article.title, article.summary, article.topic_name, article.category,
          categoryLabel, article.research_area ?? "", researchLabel,
        ].join(" "));
        return terms.every((term) => searchable.includes(term));
      });
      if (!matched.length) {
        status.textContent = "没有找到匹配的文章。";
        appendEmpty("试试更短的关键词，或换一个分类/话题名称。");
        return;
      }
      status.textContent = "找到 " + matched.length + " 篇文章。";
      render(matched);
    } catch {
      if (version !== requestVersion) return;
      status.textContent = "搜索索引暂时无法加载，请稍后重试。";
      results.replaceChildren();
    }
  };
  const initialQuery = new URL(location.href).searchParams.get("q") ?? "";
  input.value = initialQuery;
  if (initialQuery.trim()) void runSearch(initialQuery);
  input.addEventListener("input", () => void runSearch(input.value));
}
