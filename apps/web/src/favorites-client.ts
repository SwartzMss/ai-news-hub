import { api, ApiError, type AuthState, requestMessage } from "./account-api";
import { safeReturnPath } from "./account-path";
import { clearPrivateContent } from "./account-privacy";

interface Category { id: string; name: string; sortOrder: number }
interface Favorite { id: string; articleKey: string; title: string; createdAt: number; categoryId: string | null;
  topic: { id: string; name: string }; sourceName: string; sourcePublishedAt: string | null; reportDate: string }
interface Snapshot { article: { title: string; fact_summary: string; analysis: string | null; evidence_quote: string; verification: string;
  details: Record<string, unknown>; source: { name: string; original_url: string; canonical_url: string; published_at: string | null; event_at: string | null; fetched_at: string | null };
  report_date: string; report_version: number; first_approved_at: string; topic: { id: string; name: string }; key: string } }
interface FavoriteDetail { id: string; articleKey: string; categoryId: string | null; createdAt: number; snapshot: Snapshot }

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const date = (value: number | string | null) => value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(value)) : "日期未知";
const articlePath = (topicId: string, key: string) => `/topics/${encodeURIComponent(topicId)}/news/${encodeURIComponent(key)}/`;
const fieldNames: Record<string, string> = {
  background: "背景", keyFacts: "关键事实", timeline: "时间线", positions: "相关方观点", impacts: "影响",
  uncertainties: "尚待确认", watchpoints: "后续观察", metrics: "关键指标", supplyChain: "产业链",
  investmentLogic: "投资逻辑", risks: "风险", valuation: "估值", overview: "项目概览", change: "近期变化",
  technical: "技术要点", useCases: "使用场景", license: "许可证", evaluation: "评价", evidence: "来源证据",
  name: "名称", value: "数值", unit: "单位", period: "期间", comparison: "对比", basis: "依据", time: "时间",
  precision: "时间精度", event: "事件", actor: "主体", statement: "表述", form: "形式", description: "描述",
  status: "状态", segment: "环节", direction: "方向", reason: "原因", relationship: "关系", summary: "摘要",
  version: "版本", type: "类型", publishedAt: "发布时间", code: "代码", scope: "范围", nature: "性质", supports: "支持内容",
};
function snapshotDetails(details: Record<string, unknown>): HTMLElement {
  const container = el("div", "snapshot-details");
  const renderValue = (value: unknown): HTMLElement => {
    if (Array.isArray(value)) {
      const list = el("ul");
      value.forEach(item => { const row = el("li"); row.append(renderValue(item)); list.append(row); });
      return list;
    }
    if (value && typeof value === "object") {
      const list = el("dl");
      for (const [key, item] of Object.entries(value)) {
        if (key === "id" || key === "evidenceRefs" || key === "kind" || item == null) continue;
        const term = el("dt", undefined, fieldNames[key] ?? key);
        const description = el("dd");
        if (key === "url" && typeof item === "string") {
          try { const url = new URL(item); if (url.protocol === "https:") { const link = el("a", undefined, item); link.href = url.href; link.target = "_blank"; link.rel = "noopener noreferrer"; description.append(link); }
            else description.textContent = item; } catch { description.textContent = item; }
        } else description.append(renderValue(item));
        list.append(term, description);
      }
      return list;
    }
    return el("span", undefined, String(value ?? ""));
  };
  for (const [key, value] of Object.entries(details)) {
    if (key === "kind" || value == null || (Array.isArray(value) && !value.length)) continue;
    const section = el("section"); section.append(el("h3", undefined, fieldNames[key] ?? key), renderValue(value)); container.append(section);
  }
  return container;
}
function loginForReturn(path: string) {
  const safe = safeReturnPath(path, location.origin) ?? "/account/favorites/";
  location.assign(`/account/login/?return=${encodeURIComponent(safe)}`);
}

export async function mountFavoriteButton(auth: Promise<AuthState>): Promise<void> {
  const button = document.querySelector<HTMLButtonElement>("[data-favorite-key]");
  if (!button) return;
  const status = document.querySelector<HTMLElement>("[data-favorite-status]")!;
  const key = button.dataset.favoriteKey!;
  const state = await auth;
  if (state.kind === "unavailable") { button.hidden = true; return; }
  if (state.kind === "error") { button.disabled = true; status.textContent = "无法确认登录状态，请刷新页面重试。"; return; }
  let saved: { id: string } | undefined;
  const sync = () => { button.textContent = saved ? "取消收藏" : "收藏文章"; button.setAttribute("aria-pressed", String(Boolean(saved))); };
  if (state.kind === "user") {
    try { saved = (await api<{ favorites: Favorite[] }>(`/api/favorites?articleKey=${encodeURIComponent(key)}&limit=1`)).favorites[0]; sync(); }
    catch (error) { button.disabled = true; status.textContent = requestMessage(error); return; }
  }
  let pending = false;
  button.addEventListener("click", async () => {
    if (state.kind === "guest") { loginForReturn(location.pathname + location.search); return; }
    if (pending) return;
    pending = true; button.disabled = true; status.textContent = "正在更新收藏…";
    try {
      if (saved) { await api<void>(`/api/favorites/${encodeURIComponent(saved.id)}`, "DELETE"); saved = undefined; status.textContent = "已取消收藏。"; }
      else { saved = (await api<{ favorite: FavoriteDetail }>("/api/favorites", "POST", { articleKey: key })).favorite; status.textContent = "已加入收藏。"; }
      sync();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) loginForReturn(location.pathname + location.search);
      else status.textContent = requestMessage(error);
    } finally { pending = false; button.disabled = false; }
  });
}

export async function mountFavorites(auth: Promise<AuthState>): Promise<void> {
  const page = document.querySelector<HTMLElement>("[data-favorites-page]");
  if (!page) return;
  const status = page.querySelector<HTMLElement>("[data-favorites-status]")!;
  const state = await auth;
  if (state.kind !== "user") {
    if (state.kind === "guest") {
      status.replaceChildren("收藏仅自己可见，请先登录。 ");
      const link = el("a", undefined, "前往登录"); link.href = `/account/login/?return=${encodeURIComponent(location.pathname + location.search)}`; status.append(link);
    } else status.textContent = state.kind === "unavailable" ? "账户功能暂未开放。" : "无法确认登录状态，请刷新页面重试。";
    return;
  }
  const listView = page.querySelector<HTMLElement>("[data-favorites-list-view]")!;
  const list = page.querySelector<HTMLElement>("[data-favorites-list]")!;
  const detailView = page.querySelector<HTMLElement>("[data-favorite-detail]")!;
  const detailContent = page.querySelector<HTMLElement>("[data-favorite-detail-content]")!;
  const more = page.querySelector<HTMLButtonElement>("[data-favorites-more]")!;
  const categoryPanel = page.querySelector<HTMLElement>("[data-categories-panel]")!;
  const categoryList = page.querySelector<HTMLElement>("[data-category-list]")!;
  const categoryStatus = page.querySelector<HTMLElement>("[data-category-status]")!;
  const filter = page.querySelector<HTMLFormElement>("[data-favorites-filter]")!;
  const query = filter.elements.namedItem("q") as HTMLInputElement;
  const category = filter.elements.namedItem("category") as HTMLSelectElement;
  const sort = filter.elements.namedItem("sort") as HTMLSelectElement;
  let categories: Category[] = [];
  let offset = 0;
  let loading = false;
  let queuedReset = false;
  const values = new URLSearchParams(location.search);
  const detailId = values.get("id");
  query.value = (values.get("q") ?? "").slice(0, 100);
  sort.value = values.get("sort") === "oldest" ? "oldest" : "newest";
  let categoryValue = values.get("category") ?? "all";
  window.addEventListener("favorite-session-expired", () => {
    clearPrivateContent();
    status.replaceChildren("登录已失效，请重新登录。 ");
    const link = el("a", undefined, "前往登录"); link.href = `/account/login/?return=${encodeURIComponent(location.pathname + location.search)}`; status.append(link);
  }, { once: true });
  const reloadCategories = async () => {
    categories = (await api<{ categories: Category[] }>("/api/favorite-categories")).categories;
    category.replaceChildren(new Option("全部收藏", "all"), new Option("未分类", "none"),
      ...categories.map(item => new Option(item.name, item.id)));
    category.value = categories.some(item => item.id === categoryValue) || categoryValue === "none" ? categoryValue : "all";
    categoryList.replaceChildren();
    if (!categories.length) categoryList.append(el("p", "favorites-empty", "还没有分类。"));
    categories.forEach((item, index) => {
      const row = el("div", "category-row");
      const name = el("span", "category-name", item.name);
      const rename = el("button", undefined, "重命名"); rename.type = "button";
      const up = el("button", undefined, "上移"); up.type = "button"; up.disabled = index === 0;
      const down = el("button", undefined, "下移"); down.type = "button"; down.disabled = index === categories.length - 1;
      const remove = el("button", "category-delete", "删除"); remove.type = "button";
      rename.addEventListener("click", async () => {
        const next = prompt("新分类名称", item.name)?.trim();
        if (!next || next === item.name) return;
        try { await api(`/api/favorite-categories/${item.id}`, "PATCH", { name: next }); categoryStatus.textContent = "分类已重命名。"; await reloadCategories(); }
        catch (error) { categoryStatus.textContent = requestMessage(error); }
      });
      const shift = async (target: number) => {
        const reordered = [...categories];
        [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
        try {
          for (const [position, entry] of reordered.entries()) await api(`/api/favorite-categories/${entry.id}`, "PATCH", { sortOrder: position * 10 });
          await reloadCategories(); categoryStatus.textContent = "分类顺序已更新。";
        } catch (error) { categoryStatus.textContent = requestMessage(error); await reloadCategories(); }
      };
      up.addEventListener("click", () => void shift(index - 1));
      down.addEventListener("click", () => void shift(index + 1));
      remove.addEventListener("click", async () => {
        if (!confirm(`删除分类「${item.name}」？其中的收藏会移至未分类。`)) return;
        try { await api<void>(`/api/favorite-categories/${item.id}`, "DELETE");
          if (categoryValue === item.id) { categoryValue = "all"; const next = new URL(location.href); next.searchParams.delete("category"); history.replaceState({}, "", next.pathname + next.search); }
          categoryStatus.textContent = "分类已删除，文章已移至未分类。"; await reloadCategories(); if (!detailId) await loadList(true); }
        catch (error) { categoryStatus.textContent = requestMessage(error); }
      });
      row.append(name, rename, up, down, remove); categoryList.append(row);
    });
  };
  const makeCategorySelect = (favorite: Favorite | FavoriteDetail) => {
    const select = el("select", "favorite-category-select");
    select.setAttribute("aria-label", "收藏分类");
    select.append(new Option("未分类", ""), ...categories.map(item => new Option(item.name, item.id)));
    select.value = favorite.categoryId ?? "";
    select.addEventListener("change", async () => {
      select.disabled = true;
      try { await api(`/api/favorites/${favorite.id}/category`, "PATCH", { categoryId: select.value || null }); status.textContent = "分类已更新。"; favorite.categoryId = select.value || null;
        if (!detailId && category.value !== "all") await loadList(true); }
      catch (error) { select.value = favorite.categoryId ?? ""; status.textContent = requestMessage(error); }
      finally { select.disabled = false; }
    });
    return select;
  };
  const makeRemove = (favorite: Favorite | FavoriteDetail) => {
    const button = el("button", "favorite-remove", "取消收藏"); button.type = "button";
    button.addEventListener("click", async () => {
      button.disabled = true;
      try { await api<void>(`/api/favorites/${favorite.id}`, "DELETE"); status.textContent = "已取消收藏。"; if (detailId) location.assign("/account/favorites/"); else await loadList(true); }
      catch (error) { status.textContent = requestMessage(error); button.disabled = false; }
    });
    return button;
  };
  const loadList = async (reset: boolean) => {
    if (loading) { if (reset) queuedReset = true; return; }
    loading = true; more.disabled = true;
    if (reset) { offset = 0; list.replaceChildren(); }
    status.textContent = "正在加载收藏…";
    try {
      const params = new URLSearchParams({ limit: "20", offset: String(offset), sort: sort.value, category: category.value });
      if (query.value.trim()) params.set("q", query.value.trim());
      const result = await api<{ favorites: Favorite[]; hasMore: boolean }>(`/api/favorites?${params}`);
      for (const item of result.favorites) {
        const card = el("article", "favorite-card");
        const heading = el("h2"); const link = el("a", undefined, item.title); link.href = `/account/favorites/?id=${encodeURIComponent(item.id)}`; heading.append(link);
        const meta = el("p", "favorite-meta", `${item.topic.name} · ${item.sourceName} · 原文 ${date(item.sourcePublishedAt)} · 收藏 ${date(item.createdAt)}`);
        const actions = el("div", "favorite-actions"); actions.append(makeCategorySelect(item), makeRemove(item));
        card.append(heading, meta, actions); list.append(card);
      }
      offset += result.favorites.length;
      more.hidden = !result.hasMore || offset > 10000;
      if (!offset) list.append(el("p", "favorites-empty", query.value.trim() || category.value !== "all" ? "没有符合条件的收藏。" : "还没有收藏。打开文章，点击「收藏文章」即可保存。"));
      status.textContent = "";
    } catch (error) {
      status.textContent = requestMessage(error);
      if (error instanceof ApiError && error.status === 401) loginForReturn(location.pathname + location.search);
    } finally { loading = false; more.disabled = false; if (queuedReset) { queuedReset = false; void loadList(true); } }
  };
  try {
    await reloadCategories();
    categoryPanel.hidden = false;
    if (detailId) {
      if (!/^[0-9a-f-]{36}$/i.test(detailId)) throw new ApiError(404, "not_found");
      detailView.hidden = false;
      const favorite = (await api<{ favorite: FavoriteDetail }>(`/api/favorites/${encodeURIComponent(detailId)}`)).favorite;
      const article = favorite.snapshot.article;
      const heading = el("h2", undefined, article.title);
      const meta = el("p", "favorite-meta", `${article.topic.name} · ${article.source.name} · 原文 ${date(article.source.published_at)} · 收藏 ${date(favorite.createdAt)}`);
      const summary = el("p", "favorite-summary", article.fact_summary);
      const archival = el("dl", "favorite-archive-meta");
      for (const [label, value] of [
        ["原文发布时间", date(article.source.published_at)], ["事件时间", date(article.source.event_at)],
        ["抓取时间", date(article.source.fetched_at)], ["日报日期", article.report_date],
        ["日报版本", String(article.report_version)], ["首次批准时间", date(article.first_approved_at)],
        ["验证状态", article.verification],
      ]) archival.append(el("dt", undefined, label), el("dd", undefined, value));
      const source = el("a", undefined, "查看原始来源 ↗"); source.href = article.source.canonical_url; source.target = "_blank"; source.rel = "noopener noreferrer";
      const original = el("a", undefined, "查看站内文章"); original.href = articlePath(article.topic.id, favorite.articleKey);
      const actions = el("div", "favorite-actions"); actions.append(makeCategorySelect(favorite), makeRemove(favorite));
      detailContent.replaceChildren(heading, meta, archival, summary, el("h3", undefined, "原文证据摘录"), el("p", "favorite-evidence-quote", article.evidence_quote));
      if (article.analysis) detailContent.append(el("h3", undefined, "分析与推断"), el("p", undefined, article.analysis));
      detailContent.append(snapshotDetails(article.details), actions, source);
      if (article.source.original_url !== article.source.canonical_url) {
        const originalSource = el("a", undefined, "查看原始链接"); originalSource.href = article.source.original_url;
        originalSource.target = "_blank"; originalSource.rel = "noopener noreferrer"; detailContent.append(originalSource);
      }
      detailContent.append(original); status.textContent = "";
    } else { listView.hidden = false; await loadList(true); }
  } catch (error) { status.textContent = requestMessage(error); }
  more.addEventListener("click", () => void loadList(false));
  filter.addEventListener("submit", event => {
    event.preventDefault();
    categoryValue = category.value;
    const params = new URLSearchParams();
    if (query.value.trim()) params.set("q", query.value.trim());
    if (category.value !== "all") params.set("category", category.value);
    if (sort.value !== "newest") params.set("sort", sort.value);
    history.replaceState({}, "", `/account/favorites/${params.size ? `?${params}` : ""}`);
    void loadList(true);
  });
  page.querySelector<HTMLFormElement>("[data-category-create]")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    if (!form.reportValidity()) return;
    const input = form.elements.namedItem("name") as HTMLInputElement;
    const name = input.value.trim();
    if (!name) return;
    try { await api("/api/favorite-categories", "POST", { name, sortOrder: (categories.at(-1)?.sortOrder ?? -10) + 10 });
      input.value = ""; categoryStatus.textContent = "分类已创建。"; await reloadCategories(); }
    catch (error) { categoryStatus.textContent = requestMessage(error); }
  });
}
