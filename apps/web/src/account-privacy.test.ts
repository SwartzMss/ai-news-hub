import { expect, it, vi } from "vitest";
import { clearPrivateContent, watchPrivateSession } from "./account-privacy";

it("clears private content immediately when a session ends", () => {
  document.body.innerHTML = `<a data-account-nav hidden>账户</a><details class="account-menu"></details>
    <main data-account-home><div data-account-profile><strong data-account-email>reader@example.com</strong></div><div data-account-links>收藏</div></main>
    <section data-favorites-list-view><div data-favorites-list>私人文章</div></section>`;
  clearPrivateContent();
  expect(document.querySelector("[data-account-email]")!.textContent).toBe("");
  expect(document.querySelector("[data-favorites-list]")!.textContent).toBe("");
  expect(document.querySelector<HTMLElement>("[data-favorites-list-view]")!.hidden).toBe(true);
  expect(document.querySelector(".account-menu")).toBeNull();
});

it("revalidates a restored private page before showing any cached data", async () => {
  document.body.innerHTML = `<a data-account-nav hidden>账户</a><main data-account-home>
    <p data-account-status></p><div data-account-profile><strong data-account-email>old@example.com</strong></div>
    <div data-account-links>收藏</div></main>`;
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "unauthorized" }, { status: 401 })));
  watchPrivateSession();
  const event = new Event("pageshow"); Object.defineProperty(event, "persisted", { value: true });
  window.dispatchEvent(event);
  await vi.waitFor(() => expect(document.querySelector("[data-account-status]")!.textContent).toMatch(/重新登录/));
  expect(document.querySelector("[data-account-email]")!.textContent).toBe("");
  expect(document.querySelector<HTMLElement>("[data-account-profile]")!.hidden).toBe(true);
  vi.unstubAllGlobals();
});
