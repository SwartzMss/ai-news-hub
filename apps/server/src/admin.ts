import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";

// Serve only the separately built shell and flat Vite JS/CSS assets.
export function registerAdmin(app: FastifyInstance): void {
  const root = fileURLToPath(new URL("../../../admin/", import.meta.url));
  const files = new Map<string, { body: Buffer; type: string }>();
  try {
    files.set("/admin/", {
      body: readFileSync(join(root, "index.html")),
      type: "text/html; charset=utf-8",
    });
    for (const name of readdirSync(join(root, "assets"))) {
      if (/^[A-Za-z0-9_-]+\.(js|css)$/.test(name))
        files.set(`/admin/assets/${name}`, {
          body: readFileSync(join(root, "assets", name)),
          type: name.endsWith(".js")
            ? "text/javascript; charset=utf-8"
            : "text/css; charset=utf-8",
        });
    }
  } catch {
    files.clear();
  }
  app.get("/admin", async (_request, reply) => reply.redirect("/admin/"));
  app.get("/admin/*", async (request, reply) => {
    reply
      .header("cache-control", "no-store")
      .header("x-content-type-options", "nosniff")
      .header("referrer-policy", "no-referrer")
      .header(
        "content-security-policy",
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      );
    if (!files.size)
      return reply.code(503).send({ error: { code: "admin_build_missing" } });
    const file = files.get(request.url.split("?")[0]);
    if (!file) return reply.code(404).send({ error: { code: "not_found" } });
    return reply.type(file.type).send(file.body);
  });
}
