import { defineConfig } from "vitest/config";
export default defineConfig({
  base: "/admin/",
  build: { outDir: "../../dist/admin", emptyOutDir: true, sourcemap: false },
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.tsx"],
    restoreMocks: true,
  },
});
