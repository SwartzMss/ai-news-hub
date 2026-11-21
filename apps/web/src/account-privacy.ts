import { readAuth } from "./account-api";

const authChannel = typeof window === "undefined" || typeof window.BroadcastChannel === "undefined"
  ? undefined : new window.BroadcastChannel("ai-news-hub-auth");

export function notifyLogout(): void {
  clearPrivateContent();
  authChannel?.postMessage("logout");
}

export function clearPrivateContent(): void {
  const profile = document.querySelector<HTMLElement>("[data-account-profile]");
  if (profile) profile.hidden = true;
  const email = document.querySelector<HTMLElement>("[data-account-email]");
  if (email) email.textContent = "";
  const links = document.querySelector<HTMLElement>("[data-account-links]");
  if (links) links.hidden = true;
  const guest = document.querySelector<HTMLElement>("[data-account-guest]");
  if (guest) guest.hidden = true;
  const tools = document.querySelector<HTMLElement>("[data-account-tools]");
  if (tools) tools.hidden = true;
  for (const selector of ["[data-favorites-list-view]", "[data-favorite-detail]", "[data-categories-panel]"]) {
    const section = document.querySelector<HTMLElement>(selector);
    if (section) section.hidden = true;
  }
  for (const selector of ["[data-favorites-list]", "[data-favorite-detail-content]", "[data-category-list]"]) {
    document.querySelector<HTMLElement>(selector)?.replaceChildren();
  }
  document.querySelector<HTMLFormElement>("[data-favorites-filter]")?.reset();
  document.querySelector<HTMLFormElement>("[data-category-create]")?.reset();
  document.querySelector<HTMLFormElement>("[data-account-export]")?.reset();
  document.querySelector<HTMLElement>(".account-menu")?.remove();
  const nav = document.querySelector<HTMLAnchorElement>("[data-account-nav]");
  if (nav) { nav.hidden = true; nav.href = "/account/favorites/"; }
  const login = document.querySelector<HTMLElement>("[data-account-login]");
  if (login) login.hidden = true;
}

export function watchPrivateSession(): void {
  if (!document.querySelector("[data-account-home],[data-favorites-page]")) return;
  let checking = false;
  const revalidate = async () => {
    if (checking) return;
    checking = true;
    clearPrivateContent();
    const status = document.querySelector<HTMLElement>("[data-favorites-status],[data-account-home] [data-account-status]");
    if (status) { status.hidden = false; status.textContent = "正在确认登录状态…"; }
    const state = await readAuth();
    if (state.kind === "user") { location.reload(); return; }
    if (status) {
      status.textContent = state.kind === "guest" ? "登录已失效，请重新登录。 "
        : state.kind === "unavailable" ? "账户功能暂未开放。" : "无法确认登录状态，请刷新页面重试。";
      if (state.kind === "guest") {
        const link = document.createElement("a");
        link.href = `/account/login/?return=${encodeURIComponent(location.pathname + location.search)}`;
        link.textContent = "前往登录"; status.append(link);
      }
    }
    const nav = document.querySelector<HTMLAnchorElement>("[data-account-nav]");
    if (nav && state.kind === "guest") { nav.hidden = false; nav.href = "/account/login/?return=%2Faccount%2Ffavorites%2F"; }
    const login = document.querySelector<HTMLElement>("[data-account-login]");
    if (login && state.kind === "guest") login.hidden = false;
    checking = false;
  };
  window.addEventListener("pageshow", event => { if (event.persisted) void revalidate(); });
  window.addEventListener("pagehide", () => clearPrivateContent());
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void revalidate(); });
  authChannel?.addEventListener("message", event => { if (event.data === "logout") void revalidate(); });
}
