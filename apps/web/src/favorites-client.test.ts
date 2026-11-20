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
});
