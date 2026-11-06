import "./style.css";
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
    .querySelectorAll<HTMLAnchorElement>("a[data-topic-feed]")
    .forEach((a) => (a.href = `/rss/topics/${id}.xml`));
  if (shell) shell.dataset.topicId = id;
  rememberTopic(id);
  if (navigation) {
    const url = new URL(location.href);
    url.searchParams.set("topic", id);
    url.hash = "";
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
