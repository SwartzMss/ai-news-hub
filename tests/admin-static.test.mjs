import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildServer } from "../dist/apps/server/src/app.js";
import { loadConfig } from "../dist/apps/server/src/config.js";
test("admin shell and built assets are separate from authenticated private API", async () => {
  const dir = mkdtempSync(join(tmpdir(), "admin-static-"));
  const app = buildServer(
    loadConfig({
      AI_NEWS_HUB_DATA_DIR: dir,
      AI_NEWS_HUB_ADMIN_TOKEN: "test_only_0123456789_abcdefghijklmnop",
      AI_NEWS_HUB_LOG_LEVEL: "silent",
    }),
  );
  try {
    const response = await app.inject("/admin/");
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /AI News Hub/);
    assert.match(
      response.headers["content-security-policy"],
      /default-src 'self'/,
    );
    assert.equal(response.headers["cache-control"], "no-store");
    const asset = response.body.match(/src="([^"]+\.js)"/)[1];
    assert.equal((await app.inject(asset)).statusCode, 200);
    assert.equal((await app.inject("/api/tasks")).statusCode, 401);
    assert.equal((await app.inject("/admin/secrets.env")).statusCode, 404);
    assert.equal(
      (await app.inject("/admin/assets/unknown.js")).statusCode,
      404,
    );
    assert.equal((await app.inject("/admin/index.html.map")).statusCode, 404);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
