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
