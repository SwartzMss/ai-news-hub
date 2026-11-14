import "./style.css";

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

const shell = document.querySelector<HTMLElement>(".site-shell");
const choices = [
  ...document.querySelectorAll<HTMLAnchorElement>("a[data-topic-choice]"),
];
const topicIds = new Set(choices.map((a) => a.dataset.topicChoice));
const panels = [
  ...document.querySelectorAll<HTMLElement>("[data-topic-panel]"),
];
function rememberTopic(id: string) {
  try {
    localStorage.setItem("news-hub-topic", id);
  } catch {
    /* Preferences are optional. */
  }
}
function selectTopic(
  id: string,
  navigation: "replace" | "push" | false = false,
) {
  if (
    !topicIds.has(id) ||
    !panels.some((panel) => panel.dataset.topicPanel === id)
  )
    return;
  for (const panel of panels) panel.hidden = panel.dataset.topicPanel !== id;
  for (const choice of choices)
    if (choice.dataset.topicChoice === id)
      choice.setAttribute("aria-current", "page");
    else choice.removeAttribute("aria-current");
  document
    .querySelectorAll<HTMLAnchorElement>("a[data-topic-archive]")
    .forEach((a) => (a.href = `/topics/${id}/archive/`));
  const rssLink = document.querySelector<HTMLAnchorElement>("a[data-topic-rss]");
  if (rssLink) rssLink.href = `/rss/topics/${id}.xml`;
  if (shell) shell.dataset.topicId = id;
  rememberTopic(id);
  if (navigation) {
    const url = new URL(location.href);
    url.searchParams.set("topic", id);
    if (navigation === "push") url.hash = "";
    if (navigation === "push") history.pushState(null, "", url);
    else history.replaceState(null, "", url);
  }
}
if (panels.length) {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem("news-hub-topic");
  } catch {
    /* Storage may be unavailable. */
  }
  const requested = new URL(location.href).searchParams.get("topic");
  const selected =
    requested && topicIds.has(requested)
      ? requested
      : stored && topicIds.has(stored)
        ? stored
        : panels[0].dataset.topicPanel!;
  selectTopic(selected, "replace");
  addEventListener("popstate", () => {
    const id = new URL(location.href).searchParams.get("topic");
    if (id) selectTopic(id);
  });
} else if (shell?.dataset.topicId && topicIds.has(shell.dataset.topicId))
  rememberTopic(shell.dataset.topicId);
document.addEventListener("click", (event) => {
  const link =
    event.target instanceof Element
      ? event.target.closest<HTMLAnchorElement>("a[data-topic-choice]")
      : null;
  const id = link?.dataset.topicChoice;
  if (
    !id ||
    !topicIds.has(id) ||
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  rememberTopic(id);
  if (
    shell?.dataset.page === "home" &&
    panels.some((panel) => panel.dataset.topicPanel === id)
  ) {
    event.preventDefault();
    selectTopic(id, "push");
  }
});

// Keep the directory in sync with the visible story, including after topic changes.
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
