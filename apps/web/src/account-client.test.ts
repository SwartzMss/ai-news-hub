import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountAccount } from "./account-client";

const form = `<a data-account-nav href="/account/favorites/" hidden>收藏</a><a data-account-login href="/account/login/" hidden>登录</a>
<form data-account-form="login" action="/api/auth/login">
  <input name="email" type="email" value="reader@example.com" required>
  <input name="password" type="password" value="correct horse battery staple" required>
  <div data-turnstile-host hidden></div><p data-account-status></p><button type="submit">登录</button>
</form>`;

describe("account client", () => {
  beforeEach(() => { document.body.innerHTML = form; history.replaceState({}, "", "/account/login/"); vi.restoreAllMocks(); });
  it("posts credentials with same-origin cookies and returns only to a safe article path", async () => {
    history.replaceState({}, "", "/account/login/?return=%2Ftopics%2Ft-0123456789abcdef01234567%2Fnews%2Fa%2F");
    const fetcher = vi.fn(async () => Response.json({ user: { id: "u1", email: "reader@example.com" } }));
    vi.stubGlobal("fetch", fetcher);
    const navigate = vi.fn();
    await mountAccount(Promise.resolve({ kind: "guest" }), navigate);
    document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith("/topics/t-0123456789abcdef01234567/news/a/"));
    expect(fetcher).toHaveBeenCalledWith("/api/auth/login", expect.objectContaining({ method: "POST", credentials: "same-origin" }));
  });
  it("does not expose an unavailable account flow", async () => {
    await mountAccount(Promise.resolve({ kind: "unavailable" }), vi.fn());
    expect(document.querySelector<HTMLAnchorElement>("[data-account-nav]")!.hidden).toBe(true);
    expect(document.querySelector<HTMLAnchorElement>("[data-account-login]")!.hidden).toBe(true);
    expect(document.querySelector<HTMLInputElement>('input[name="email"]')!.disabled).toBe(true);
    expect(document.querySelector("[data-account-status]")!.textContent).toMatch(/暂未开放/);
  });
  it("shows a shared account menu for a signed-in reader", async () => {
    document.body.innerHTML = `<nav><a data-account-nav href="/account/favorites/" hidden>收藏</a></nav><div class="header-actions"><a data-account-login href="/account/login/" hidden>登录</a></div>`;
    await mountAccount(Promise.resolve({ kind: "user", user: { id: "u1", email: "reader@example.com" } }), vi.fn());
    expect(document.querySelector(".account-menu summary")?.textContent).toBe("我的账户");
    expect(document.querySelector(".account-menu-email")?.textContent).toBe("reader@example.com");
    expect(document.querySelector<HTMLElement>(".header-actions .account-menu")).not.toBeNull();
    expect(document.querySelector<HTMLAnchorElement>("[data-account-nav]")!.hidden).toBe(false);
    expect(document.querySelector<HTMLAnchorElement>("[data-account-login]")!.hidden).toBe(true);
  });
  it("takes a guest from 收藏 to login and back to 收藏", async () => {
    await mountAccount(Promise.resolve({ kind: "guest" }), vi.fn());
    expect(document.querySelector<HTMLAnchorElement>("[data-account-nav]")!.href).toContain("/account/login/?return=%2Faccount%2Ffavorites%2F");
    expect(document.querySelector<HTMLAnchorElement>("[data-account-login]")!.hidden).toBe(false);
  });
});
