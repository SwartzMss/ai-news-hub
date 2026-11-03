import test from "node:test";
import assert from "node:assert/strict";
import { publicationFixture } from "./fixtures/publication.mjs";
import { buildServer } from "../dist/apps/server/src/app.js";
import { loadConfig } from "../dist/apps/server/src/config.js";
test("publication endpoints require admin auth and explicit matching approval; failures persist", async () => {
  const fixture = publicationFixture();
  const dir = fixture.db
    .prepare("PRAGMA database_list")
    .get()
    .file.replace(/\/news.db$/, "");
  fixture.db.close();
  const token = "test_only_0123456789_abcdefghijklmnop";
  let writes = 0;
  const app = buildServer(
    loadConfig({
      AI_NEWS_HUB_DATA_DIR: dir,
      AI_NEWS_HUB_ADMIN_TOKEN: token,
      AI_NEWS_HUB_LOG_LEVEL: "silent",
      AI_NEWS_HUB_GITHUB_REPOSITORY: "owner/archive",
      AI_NEWS_HUB_GITHUB_BRANCH: "reports",
      AI_NEWS_HUB_GITHUB_TOKEN: token,
    }),
    {
      githubAdapter: {
        async publish() {
          writes++;
          return { sha: "a".repeat(40), committedAt: "2026-11-03T01:00:00Z" };
        },
      },
    },
  );
  const headers = { authorization: `Bearer ${token}` };
  try {
    assert.equal(
      (await app.inject("/api/news/reports/r/publication")).statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/news/reports/r/publish",
          headers,
          payload: {},
        })
      ).statusCode,
      409,
    );
    const status = (
      await app.inject({ url: "/api/news/reports/r/publication", headers })
    ).json();
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/news/reports/r/approve",
          headers,
          payload: { contentHash: status.contentHash, confirm: false },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/news/reports/r/approve",
          headers,
          payload: { contentHash: status.contentHash, confirm: true },
        })
      ).statusCode,
      200,
    );
    for (let i = 0; i < 2; i++)
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/news/reports/r/publish",
            headers,
            payload: {},
          })
        ).json().publication.status,
        "succeeded",
      );
    assert.equal(writes, 1);
  } finally {
    await app.close();
    const { rmSync } = await import("node:fs");
    rmSync(dir, { recursive: true, force: true });
  }
});
