import { api, ApiError, type AuthState, requestMessage } from "./account-api";
import { safeReturnPath } from "./account-path";
import { notifyLogout } from "./account-privacy";
import { mountAccountDataControls } from "./account-data-client";

type Widget = string;
type Turnstile = {
  render: (host: HTMLElement, config: { sitekey: string; action: string; callback: (token: string) => void; "expired-callback": () => void; "error-callback": () => void }) => Widget;
  reset: (id: Widget) => void;
};
declare global { interface Window { turnstile?: Turnstile } }

let turnstileScript: Promise<void> | undefined;
function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  turnstileScript ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => window.turnstile ? resolve() : reject(Error("turnstile_unavailable"));
    script.onerror = () => reject(Error("turnstile_unavailable"));
    document.head.append(script);
  });
  return turnstileScript;
}

export async function mountAccount(auth: Promise<AuthState>, navigate: (path: string) => void = path => location.assign(path)): Promise<void> {
  const state = await auth;
  const nav = document.querySelector<HTMLAnchorElement>("[data-account-nav]");
  if (nav) {
    nav.hidden = state.kind === "unavailable";
    if (state.kind === "user") {
      nav.hidden = true;
      const menu = document.createElement("details"); menu.className = "account-menu";
      const summary = document.createElement("summary"); summary.textContent = "我的账户";
      if (location.pathname.startsWith("/account/")) summary.setAttribute("aria-current", "page");
      const items = document.createElement("div"); items.className = "account-menu-items";
      const account = document.createElement("a"); account.href = "/account/"; account.textContent = "账户概览";
      const favorites = document.createElement("a"); favorites.href = "/account/favorites/"; favorites.textContent = "我的收藏";
      const logout = document.createElement("button"); logout.type = "button"; logout.textContent = "退出登录";
      const menuStatus = document.createElement("span"); menuStatus.setAttribute("role", "status");
      logout.addEventListener("click", async () => {
        logout.disabled = true;
        try { await api<void>("/api/auth/logout", "POST"); notifyLogout(); navigate("/"); }
        catch (error) { menuStatus.textContent = requestMessage(error); logout.disabled = false; }
      });
      items.append(account, favorites, logout, menuStatus); menu.append(summary, items); nav.after(menu);
    }
  }
  const form = document.querySelector<HTMLFormElement>("[data-account-form]");
  const home = document.querySelector<HTMLElement>("[data-account-home]");
  if (home) {
    const status = home.querySelector<HTMLElement>("[data-account-status]")!;
    const profile = home.querySelector<HTMLElement>("[data-account-profile]")!;
    const links = home.querySelector<HTMLElement>("[data-account-links]")!;
    if (state.kind === "user") {
      status.textContent = "";
      profile.hidden = links.hidden = false;
      const tools = home.querySelector<HTMLElement>("[data-account-tools]");
      if (tools) { tools.hidden = false; mountAccountDataControls(navigate); }
      profile.querySelector<HTMLElement>("[data-account-email]")!.textContent = state.user.email;
      home.querySelector<HTMLButtonElement>("[data-account-logout]")?.addEventListener("click", async () => {
        try { await api<void>("/api/auth/logout", "POST"); notifyLogout(); navigate("/"); }
        catch (error) { status.textContent = requestMessage(error); }
      });
    } else if (state.kind === "guest") {
      status.replaceChildren("请先登录。 ");
      const link = document.createElement("a"); link.href = "/account/login/?return=%2Faccount%2F"; link.textContent = "前往登录"; status.append(link);
    } else status.textContent = state.kind === "unavailable" ? "账户功能暂未开放。" : "无法确认登录状态，请刷新页面重试。";
  }
  if (!form) return;
  const status = form.querySelector<HTMLElement>("[data-account-status]")!;
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const kind = form.dataset.accountForm as "login" | "register" | "forgot-password";
  const returnPath = safeReturnPath(new URLSearchParams(location.search).get("return"), location.origin);
  document.querySelectorAll<HTMLAnchorElement>("[data-preserve-return]").forEach(link => {
    if (returnPath) { const url = new URL(link.href); url.searchParams.set("return", returnPath); link.href = url.pathname + url.search; }
  });
  form.querySelectorAll<HTMLButtonElement>("[data-password-toggle]").forEach(button => {
    button.addEventListener("click", () => {
      const input = document.getElementById(button.dataset.passwordToggle!) as HTMLInputElement | null;
      if (!input) return;
      input.type = input.type === "password" ? "text" : "password";
      button.textContent = input.type === "password" ? "显示" : "隐藏";
      button.setAttribute("aria-pressed", String(input.type === "text"));
    });
  });
  if (state.kind === "unavailable" || state.kind === "error") {
    form.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input,button").forEach(element => { element.disabled = true; });
    status.textContent = state.kind === "unavailable" ? "账户功能暂未开放。" : "无法连接账户服务，请刷新页面重试。";
    return;
  }
  if (state.kind === "user" && kind === "login") { navigate(returnPath ?? "/account/"); return; }
  let widget: Widget | undefined;
  let token = "";
  let challenge: Promise<void> | undefined;
  const showChallenge = async () => {
    const host = form.querySelector<HTMLElement>("[data-turnstile-host]")!;
    host.hidden = false;
    challenge ??= (async () => {
      const config = await api<{ turnstileSiteKey: string }>("/api/auth/config");
      await loadTurnstile();
      widget = window.turnstile!.render(host, { sitekey: config.turnstileSiteKey,
        action: kind === "forgot-password" ? "forgot_password" : kind,
        callback: value => { token = value; status.textContent = "验证完成，可以提交。"; },
        "expired-callback": () => { token = ""; status.textContent = "验证已过期，请重新完成。"; },
        "error-callback": () => { token = ""; status.textContent = "验证未完成，请重试。"; },
      });
    })().catch(error => { challenge = undefined; throw error; });
    return challenge;
  };
  if (kind !== "login") void showChallenge().catch(() => { status.textContent = "人机验证暂不可用，请稍后刷新重试。"; });
  let pending = false;
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (pending || !form.reportValidity()) return;
    const email = form.elements.namedItem("email") as HTMLInputElement;
    const password = form.elements.namedItem("password") as HTMLInputElement | null;
    const confirm = form.elements.namedItem("confirm-password") as HTMLInputElement | null;
    if (confirm && password?.value !== confirm.value) {
      confirm.setCustomValidity("两次输入的密码不一致"); confirm.reportValidity(); confirm.setCustomValidity(""); return;
    }
    if (kind !== "login" && !token) { status.textContent = "请先完成人机验证。"; return; }
    pending = true; submit.disabled = true; status.textContent = "正在提交…";
    try {
      const body = { email: email.value.trim(), ...(password ? { password: password.value } : {}), ...(token ? { turnstileToken: token } : {}) };
      await api(form.action.replace(location.origin, ""), "POST", body);
      if (kind === "login") navigate(returnPath ?? "/account/");
      else { status.textContent = kind === "register" ? "如果可以注册，我们会发送验证邮件。请查收邮箱。" : "如果账户可以重置，我们会发送重置邮件。请查收邮箱。"; form.reset(); }
    } catch (error) {
      status.textContent = requestMessage(error);
      if (kind === "login" && error instanceof ApiError && error.code === "turnstile_required") {
        try { await showChallenge(); } catch { status.textContent = "人机验证暂不可用，请稍后刷新重试。"; }
      }
    } finally {
      if (widget && window.turnstile) { window.turnstile.reset(widget); token = ""; }
      pending = false; submit.disabled = false;
    }
  });
}
