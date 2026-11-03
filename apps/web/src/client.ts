import "./style.css";
const button = document.getElementById("theme-toggle");
button?.addEventListener("click", () => {
  const mode =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = mode;
  button.setAttribute("aria-pressed", String(mode === "dark"));
});
