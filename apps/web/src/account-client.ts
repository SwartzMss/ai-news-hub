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
  const login = document.querySelector<HTMLAnchorElement>("[data-account-login]");
  if (login) login.hidden = state.kind !== "guest";
  if (nav) {
    nav.hidden = state.kind !== "guest" && state.kind !== "user";
    nav.href = state.kind === "guest" ? "/account/login/?return=%2Faccount%2Ffavorites%2F" : "/account/favorites/";
    if (state.kind === "user") {
      const menu = document.createElement("details"); menu.className = "account-menu";
      const summary = document.createElement("summary"); summary.textContent = "我的账户";
      if (location.pathname.startsWith("/account/") && !location.pathname.startsWith("/account/favorites/")) summary.setAttribute("aria-current", "page");
      const items = document.createElement("div"); items.className = "account-menu-items";
      const email = document.createElement("span"); email.className = "account-menu-email"; email.textContent = state.user.email;
      const account = document.createElement("a"); account.href = "/account/"; account.textContent = "账户概览";
      const logout = document.createElement("button"); logout.type = "button"; logout.textContent = "退出登录";
      const menuStatus = document.createElement("span"); menuStatus.setAttribute("role", "status");
      logout.addEventListener("click", async () => {
        logout.disabled = true;
        try { await api<void>("/api/auth/logout", "POST"); notifyLogout(); navigate("/"); }
        catch (error) { menuStatus.textContent = requestMessage(error); logout.disabled = false; }
      });
      items.append(email, account, logout, menuStatus); menu.append(summary, items); (login ?? nav).after(menu);
    }
  }
  const form = document.querySelector<HTMLFormElement>("[data-account-form]");
  const home = document.querySelector<HTMLElement>("[data-account-home]");
  if (home) {
    const status = home.querySelector<HTMLElement>("[data-account-status]")!;
    const guest = home.querySelector<HTMLElement>("[data-account-guest]");
    const profile = home.querySelector<HTMLElement>("[data-account-profile]")!;
    const links = home.querySelector<HTMLElement>("[data-account-links]")!;
    if (state.kind === "user") {
      status.textContent = "";
      status.hidden = true;
      profile.hidden = links.hidden = false;
      const tools = home.querySelector<HTMLElement>("[data-account-tools]");
      if (tools) { tools.hidden = false; mountAccountDataControls(); }
      profile.querySelector<HTMLElement>("[data-account-email]")!.textContent = state.user.email;
      home.querySelector<HTMLButtonElement>("[data-account-logout]")?.addEventListener("click", async () => {
        try { await api<void>("/api/auth/logout", "POST"); notifyLogout(); navigate("/"); }
        catch (error) { status.hidden = false; status.textContent = requestMessage(error); }
      });
    } else if (state.kind === "guest") {
      if (guest) { guest.hidden = false; status.hidden = true; status.textContent = ""; }
      else {
        status.replaceChildren("请先登录。 ");
        const link = document.createElement("a"); link.href = "/account/login/?return=%2Faccount%2F"; link.textContent = "前往登录"; status.append(link);
      }
    } else { status.hidden = false; status.textContent = state.kind === "unavailable" ? "账户功能暂未开放。" : "无法确认登录状态，请刷新页面重试。"; }
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
  const sendStep = form.querySelector<HTMLElement>("[data-register-send]");
  const verifyStep = form.querySelector<HTMLElement>("[data-register-verify]");
  const emailInput = form.elements.namedItem("email") as HTMLInputElement;
  let isVerification = false;
  const setRegisterStep = (verify: boolean) => {
    if (kind !== "register" || !sendStep || !verifyStep) return;
    isVerification = verify;
    sendStep.hidden = verify;
    verifyStep.hidden = !verify;
    verifyStep.querySelectorAll<HTMLInputElement>("input").forEach(input => { input.disabled = !verify; });
    emailInput.readOnly = verify;
    form.action = verify ? "/api/auth/verify-email-code" : "/api/auth/register";
    submit.textContent = verify ? "确认邮箱并创建账户" : "发送验证码";
    if (verify) verifyStep.querySelector<HTMLInputElement>('input[name="code"]')?.focus();
    else emailInput.focus();
  };
  if (kind === "register") {
    form.querySelector<HTMLButtonElement>("[data-register-have-code]")?.addEventListener("click", () => {
      if (emailInput.reportValidity()) { setRegisterStep(true); status.textContent = "请输入邮件中的验证码并设置密码。"; }
    });
    const backToEmail = () => { setRegisterStep(false); status.textContent = "请完成人机验证后重新发送验证码。"; };
    form.querySelector<HTMLButtonElement>("[data-register-resend]")?.addEventListener("click", backToEmail);
    form.querySelector<HTMLButtonElement>("[data-register-back]")?.addEventListener("click", backToEmail);
  }
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
    const email = emailInput;
    const password = form.elements.namedItem("password") as HTMLInputElement | null;
    const confirm = form.elements.namedItem("confirm-password") as HTMLInputElement | null;
    if (isVerification && confirm && password?.value !== confirm.value) {
      confirm.setCustomValidity("两次输入的密码不一致"); confirm.reportValidity(); confirm.setCustomValidity(""); return;
    }
    if (kind !== "login" && !isVerification && !token) { status.textContent = "请先完成人机验证。"; return; }
    pending = true; submit.disabled = true; status.textContent = "正在提交…";
    try {
      const body = isVerification
        ? { email: email.value.trim(), code: (form.elements.namedItem("code") as HTMLInputElement).value.trim(), password: password!.value }
        : { email: email.value.trim(), ...(kind === "login" ? { password: password!.value } : {}), ...(token ? { turnstileToken: token } : {}) };
      await api(form.action.replace(location.origin, ""), "POST", body);
      if (kind === "login") navigate(returnPath ?? "/account/");
      else if (isVerification) navigate(returnPath ? `/account/login/?return=${encodeURIComponent(returnPath)}` : "/account/login/");
      else if (kind === "register") {
        setRegisterStep(true);
        status.textContent = "如果该邮箱可以注册，请查收最近一封验证码邮件；60 秒内不会重复发送。";
        const resend = form.querySelector<HTMLButtonElement>("[data-register-resend]");
        if (resend) {
          resend.disabled = true; resend.textContent = "60 秒后可重发";
          window.setTimeout(() => { resend.disabled = false; resend.textContent = "重新发送验证码"; }, 60000);
        }
      } else { status.textContent = "如果账户可以重置，我们会发送重置邮件。请查收邮箱。"; form.reset(); }
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
