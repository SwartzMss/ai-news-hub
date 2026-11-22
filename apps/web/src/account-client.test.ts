import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountAccount } from "./account-client";

const form = `<a data-account-nav href="/account/favorites/" hidden>收藏</a><a data-account-login href="/account/login/" hidden>登录</a>
<form data-account-form="login" action="/api/auth/login">
  <input name="email" type="email" value="reader@example.com" required>
  <input name="password" type="password" value="correct horse battery staple" required>
  <div data-turnstile-host hidden></div><p data-account-status></p><button type="submit">登录</button>
</form>`;

describe("account client", () => {
  beforeEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); delete window.turnstile; document.body.innerHTML = form; history.replaceState({}, "", "/account/login/"); });
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
  it("sends a registration code, then confirms it with a password on the same page", async () => {
    history.replaceState({}, "", "/account/register/");
    document.body.innerHTML = `<form data-account-form="register" action="/api/auth/register">
      <input name="email" type="email" value="reader@example.com" required>
      <div data-register-send><div data-turnstile-host></div></div>
      <div data-register-verify hidden>
        <input name="code" value="123456" pattern="[0-9]{6}" required disabled>
        <input name="password" type="password" value="correct horse battery staple" required disabled>
        <input name="confirm-password" type="password" value="correct horse battery staple" required disabled>
        <button type="button" data-register-resend>重新发送</button>
      </div>
      <p data-account-status></p><button type="submit">发送验证码</button>
    </form>`;
    const requests: Array<{ path: string; body: Record<string, string> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (path: string, options?: RequestInit) => {
      if (path === "/api/auth/config") return Response.json({ turnstileSiteKey: "site-test" });
      requests.push({ path, body: JSON.parse(String(options?.body)) });
      return Response.json(path === "/api/auth/register" ? { resendAfterSeconds: 60 } : { verified: true }, { status: path === "/api/auth/register" ? 202 : 200 });
    }));
    window.turnstile = { render: (_host, options) => { options.callback("valid-challenge"); return "widget"; }, reset: vi.fn() };
    const navigate = vi.fn();
    await mountAccount(Promise.resolve({ kind: "guest" }), navigate);
    await vi.waitFor(() => expect(document.querySelector("[data-account-status]")!.textContent).toContain("验证完成"));
    document.querySelector("form")!.requestSubmit();
    await vi.waitFor(() => expect(document.querySelector<HTMLElement>("[data-register-verify]")!.hidden).toBe(false));
    expect(requests[0]).toEqual({ path: "/api/auth/register", body: { email: "reader@example.com", turnstileToken: "valid-challenge" } });
    document.querySelector("form")!.requestSubmit();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith("/account/login/"));
    expect(requests[1]).toEqual({ path: "/api/auth/verify-email-code", body: { email: "reader@example.com", code: "123456", password: "correct horse battery staple" } });
  });
});
