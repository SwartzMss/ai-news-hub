import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountFavorites } from "./favorites-client";

const markup = `<main data-favorites-page><p data-favorites-status></p>
<section data-favorites-list-view hidden><form data-favorites-filter><input name="q"><select name="category"><option value="all">全部</option></select><select name="sort"><option value="newest">最近</option></select></form><div data-favorites-list></div><button data-favorites-more hidden></button></section>
<section data-favorite-detail hidden><div data-favorite-detail-content></div></section>
<section data-categories-panel hidden><form data-category-create><input name="name" required></form><p data-category-status></p><div data-category-list></div></section></main>`;

describe("private favorites page", () => {
  beforeEach(() => { document.body.innerHTML = markup; history.replaceState({}, "", "/account/favorites/"); vi.restoreAllMocks(); });
  it("renders API data as text and offers category selection", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => input.startsWith("/api/favorite-categories")
      ? Response.json({ categories: [{ id: "c1", name: "稍后读", sortOrder: 0 }] })
      : Response.json({ favorites: [{ id: "f1", articleKey: "a".repeat(32), title: "<img src=x onerror=alert(1)>", createdAt: Date.now(), categoryId: null,
        topic: { id: "t-0123456789abcdef01234567", name: "AI" }, sourceName: "原始来源", sourcePublishedAt: null, reportDate: "2026-11-19" }], hasMore: false })));
    await mountFavorites(Promise.resolve({ kind: "user", user: { id: "u1", email: "reader@example.com" } }));
    expect(document.querySelector(".favorite-card h2")?.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(document.querySelector(".favorite-card img")).toBeNull();
    expect(document.querySelector<HTMLSelectElement>(".favorite-category-select")?.options.length).toBe(2);
  });
  it("keeps private panels hidden for guests", async () => {
    await mountFavorites(Promise.resolve({ kind: "guest" }));
    expect(document.querySelector<HTMLElement>("[data-favorites-list-view]")!.hidden).toBe(true);
    expect(document.querySelector("[data-favorites-status]")!.textContent).toMatch(/登录/);
  });
  it("refreshes a filtered list after moving a favorite to another category", async () => {
    history.replaceState({}, "", "/account/favorites/?category=c1");
    let moved = false;
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      if (input === "/api/favorite-categories") return Response.json({ categories: [
        { id: "c1", name: "一", sortOrder: 0 }, { id: "c2", name: "二", sortOrder: 10 }] });
      if (init?.method === "PATCH") { moved = true; return Response.json({ favorite: {} }); }
      return Response.json({ favorites: moved ? [] : [{ id: "f1", articleKey: "a".repeat(32), title: "收藏", createdAt: Date.now(), categoryId: "c1",
        topic: { id: "t-0123456789abcdef01234567", name: "AI" }, sourceName: "来源", sourcePublishedAt: null, reportDate: "2026-11-19" }], hasMore: false });
    }));
    await mountFavorites(Promise.resolve({ kind: "user", user: { id: "u1", email: "reader@example.com" } }));
    const select = document.querySelector<HTMLSelectElement>(".favorite-category-select")!;
    select.value = "c2"; select.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(document.querySelector(".favorite-card")).toBeNull());
    expect(document.querySelector("[data-favorites-list]")!.textContent).toMatch(/没有符合条件/);
  });
  it("shows all saved snapshot fields in the private detail", async () => {
    history.replaceState({}, "", "/account/favorites/?id=33333333-3333-4333-8333-333333333333");
    vi.stubGlobal("fetch", vi.fn(async (input: string) => input === "/api/favorite-categories"
      ? Response.json({ categories: [] })
      : Response.json({ favorite: { id: "33333333-3333-4333-8333-333333333333", articleKey: "a".repeat(32), categoryId: null, createdAt: Date.now(),
        snapshot: { article: { title: "存档", category: "科技", research_area: "agent", importance: 3, fact_summary: "事实摘要", analysis: "分析", evidence_quote: "原文引文", verification: "source_only",
          details: { kind: "news", background: "背景", evidence: [] }, source: { name: "来源", original_url: "https://example.com/a", canonical_url: "https://example.com/a", published_at: null, event_at: null, fetched_at: null },
          report_date: "2026-11-19", report_version: 3, first_approved_at: "2026-11-19T02:00:00Z", topic: { id: "t-0123456789abcdef01234567", name: "AI" }, key: "a".repeat(32) } } } })));
    await mountFavorites(Promise.resolve({ kind: "user", user: { id: "u1", email: "reader@example.com" } }));
    const content = document.querySelector("[data-favorite-detail-content]")!.textContent!;
    expect(content).toContain("原文引文");
    expect(content).toContain("source_only");
    expect(content).toContain("2026-11-19");
    expect(content).toContain("日报版本3");
    expect(content).toContain("文章分类科技");
    expect(content).toContain("研究方向agent");
  });
});
