import "./style.css";
import { mountSiteSearch } from "./search-client";
import { readAuth } from "./account-api";
import { mountAccount } from "./account-client";
import { mountFavoriteButton, mountFavorites } from "./favorites-client";
import { watchPrivateSession } from "./account-privacy";

mountSiteSearch();
const auth = readAuth();
void mountAccount(auth).catch(() => console.warn("account_ui_failed"));
void mountFavoriteButton(auth).catch(() => console.warn("favorite_button_failed"));
void mountFavorites(auth).catch(() => console.warn("favorites_ui_failed"));
watchPrivateSession();

// Articles opened from the merged home feed should return to that feed.
// Topic-specific article links keep their existing topic destination.
if (new URLSearchParams(location.search).get("from") === "home") {
  document.querySelector<HTMLAnchorElement>("[data-return-home]")?.setAttribute("href", "/");
}

const stickyHeader = document.querySelector<HTMLElement>("[data-sticky-header]");
if (stickyHeader) {
  const syncStickyHeaderHeight = () => {
    const height = Math.ceil(stickyHeader.getBoundingClientRect().height);
    document.documentElement.style.setProperty("--sticky-header-height", `${height}px`);
  };
  syncStickyHeaderHeight();
  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(syncStickyHeaderHeight);
    observer.observe(stickyHeader);
  }
  window.addEventListener("resize", syncStickyHeaderHeight, { passive: true });
}

const newsletterDialog = document.querySelector<HTMLDialogElement>("#newsletter-dialog");
document.querySelectorAll<HTMLButtonElement>("[data-newsletter-open]").forEach((trigger) => {
  trigger.addEventListener("click", () => {
    if (newsletterDialog && !newsletterDialog.open) newsletterDialog.showModal();
  });
});
document.querySelectorAll<HTMLButtonElement>("[data-newsletter-close]").forEach((close) => {
  close.addEventListener("click", () => newsletterDialog?.close());
});
newsletterDialog?.addEventListener("click", (event) => {
  if (event.target === newsletterDialog) newsletterDialog.close();
});
if (location.hash === "#newsletter-dialog" && newsletterDialog && !newsletterDialog.open)
  newsletterDialog.showModal();

const newsletterForm = document.querySelector<HTMLFormElement>("[data-newsletter-form]");
if (newsletterForm) {
  const email = newsletterForm.querySelector<HTMLInputElement>('[name="email"]')!;
  const website = newsletterForm.querySelector<HTMLInputElement>('[name="website"]')!;
  const submit = newsletterForm.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const status = newsletterForm.querySelector<HTMLElement>("[data-newsletter-status]")!;
  let pending = false;
  newsletterForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (pending || !newsletterForm.reportValidity()) return;
    pending = true;
    submit.disabled = true;
    status.textContent = "正在提交…";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch("/api/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "omit",
        signal: controller.signal,
        body: JSON.stringify({ email: email.value.trim(), website: website.value }),
      });
      if (response.status === 202) {
        status.textContent = "如邮箱可接收订阅邮件，请查收并确认。";
        newsletterForm.reset();
      } else if (response.status === 429) {
        status.textContent = "提交过于频繁，请稍后再试。";
      } else if (response.status === 503) {
        status.textContent = "邮件订阅暂不可用，请稍后再试。";
      } else {
        status.textContent = "订阅未提交，请检查邮箱后重试。";
      }
    } catch {
      status.textContent = "暂时无法提交，请稍后重试。";
    } finally {
      clearTimeout(timeout);
      pending = false;
      submit.disabled = false;
    }
  });
}

const button = document.getElementById("theme-toggle");
function applyTheme(mode: string) {
  document.documentElement.dataset.theme = mode;
  button?.setAttribute("aria-pressed", String(mode === "dark"));
}
try {
  const saved = localStorage.getItem("news-hub-theme");
  applyTheme(
    saved === "light" || saved === "dark"
      ? saved
      : matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light",
  );
} catch {
  applyTheme(
    matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  );
}
button?.addEventListener("click", () => {
  const mode =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(mode);
  try {
    localStorage.setItem("news-hub-theme", mode);
  } catch {
    /* Reading remains available when storage is blocked. */
  }
});

// Keep the directory in sync with the visible story.
function markBriefStory(id: string) {
  document
    .querySelectorAll<HTMLAnchorElement>("a[data-brief-target]")
    .forEach((link) => {
      if (link.dataset.briefTarget === id)
        link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
}
document.addEventListener("click", (event) => {
  const link =
    event.target instanceof Element
      ? event.target.closest<HTMLAnchorElement>("a[data-brief-target]")
      : null;
  if (
    !link ||
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  markBriefStory(link.dataset.briefTarget!);
  const details = link.closest<HTMLDetailsElement>("details.brief-mobile-toc");
  if (details) details.open = false;
});
if (typeof IntersectionObserver !== "undefined") {
  const visible = new Map<Element, number>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting)
          visible.set(entry.target, entry.boundingClientRect.top);
        else visible.delete(entry.target);
      }
      const current = [...visible.entries()]
        .filter(([node]) => node.getClientRects().length > 0)
        .sort((a, b) => a[1] - b[1])[0]?.[0];
      if (current?.id) markBriefStory(current.id);
    },
    { rootMargin: "-5% 0px -55% 0px", threshold: 0 },
  );
  document
    .querySelectorAll("[data-brief-story]")
    .forEach((story) => observer.observe(story));
}
if (location.hash) {
  try {
    const target = document.getElementById(
      decodeURIComponent(location.hash.slice(1)),
    );
    if (target?.matches("[data-brief-story]") && target.getClientRects().length)
      target.scrollIntoView();
  } catch {
    /* Malformed fragments do not prevent reading. */
  }
}

function markDetailSection(id:string){
  document.querySelectorAll<HTMLAnchorElement>('a[data-detail-target]').forEach(link=>{
    if(link.dataset.detailTarget===id)link.setAttribute('aria-current','location');
    else link.removeAttribute('aria-current');
  });
}
const detailLinks=[...document.querySelectorAll<HTMLAnchorElement>('a[data-detail-target]')];
if(detailLinks.length){
  document.addEventListener('click',event=>{
    const link=event.target instanceof Element?event.target.closest<HTMLAnchorElement>('a[data-detail-target]'):null;
    if(!link)return;
    markDetailSection(link.dataset.detailTarget!);
    const menu=link.closest<HTMLDetailsElement>('details.detail-mobile-nav');
    if(menu)menu.open=false;
  });
  const sections=[...new Set(detailLinks.map(link=>link.dataset.detailTarget!))].map(id=>document.getElementById(id)).filter((element):element is HTMLElement=>!!element);
  const update=()=>{
    const current=[...sections].reverse().find(section=>section.getBoundingClientRect().top<=Math.max(120,window.innerHeight*0.25))??sections[0];
    if(current)markDetailSection(current.id);
  };
  if('IntersectionObserver' in window){
    const observer=new IntersectionObserver(update,{rootMargin:'-15% 0px -65% 0px'});
    sections.forEach(section=>observer.observe(section));
  }
  window.addEventListener('scroll',update,{passive:true});
  window.addEventListener('hashchange',update);
  update();
}
