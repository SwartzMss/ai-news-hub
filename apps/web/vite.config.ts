import { defineConfig } from "vite";
export default defineConfig({
  envPrefix: "PUBLIC_NEVER_EMBED_",
  publicDir: false,
  oxc: { jsx: { runtime: "automatic" } },
  build: { sourcemap: false, target: "es2022" },
});
