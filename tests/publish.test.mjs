import test from "node:test";
import assert from "node:assert/strict";
import { PublicationService } from "../dist/apps/server/src/publish/service.js";

import { publicationFixture as fixture } from "./fixtures/publication.mjs";
const target = { repository: "owner/archive", branch: "reports" };
const hash = (s) => s.inspect("r").contentHash;
test("pending cannot publish; explicit approval binds snapshot; repeat is idempotent", async () => {
  const s = fixture();
  let calls = 0;
  let saved;
  const adapter = {
    async publish(artifact) {
      calls++;
      saved = artifact;
      return { sha: "a".repeat(40), committedAt: "2026-11-03T01:00:00Z" };
    },
  };
  try {
    const p = new PublicationService(s.db, target, adapter);
    await assert.rejects(p.publish("r"), /report_not_approved/);
    assert.equal(calls, 0);
    assert.throws(() => p.approve("r", "wrong"), /report_changed/);
    p.approve("r", hash(p));
    const first = await p.publish("r");
    const second = await p.publish("r");
    assert.equal(first.commit_sha, "a".repeat(40));
    assert.equal(second.id, first.id);
    assert.equal(calls, 1);
    assert.equal(saved.path, "reports/2026/11/03/opensource/v000001.json");
    const json = JSON.parse(saved.content);
    assert.equal(json.schema_version, 1);
    assert.equal(json.review_status, "approved");
    assert.equal(json.items[0].id, "a");
    assert.equal(json.items[0].source.published_at, null);
    assert.ok(!saved.content.includes("run_id"));
    assert.ok(!saved.content.includes("candidates_json"));
    assert.equal(
      s.db.prepare("SELECT status FROM reports WHERE id='r'").get().status,
      "published",
    );
  } finally {
    s.close();
  }
});
test("failed remote call keeps report approved and explicit retry reuses same record", async () => {
  const s = fixture();
  let calls = 0;
  try {
    const p = new PublicationService(s.db, target, {
      async publish() {
        if (++calls === 1) throw new Error("TOKEN_SECRET");
        return { sha: "b".repeat(40), committedAt: "2026-11-03T01:00:00Z" };
      },
    });
    p.approve("r", hash(p));
    const failed = await p.publish("r");
    assert.equal(failed.status, "failed");
    assert.equal(failed.error_code, "github_unavailable");
    assert.ok(!JSON.stringify(failed).includes("TOKEN_SECRET"));
    assert.equal(
      s.db.prepare("SELECT status FROM reports WHERE id='r'").get().status,
      "approved",
    );
    const retry = await p.publish("r");
    assert.equal(retry.id, failed.id);
    assert.equal(retry.status, "succeeded");
    assert.equal(retry.attempts, 2);
  } finally {
    s.close();
  }
});
test("drafts, failed runs, source tampering, missing links and changed approval cannot publish", async () => {
  for (const sql of [
    "UPDATE reports SET status='draft'",
    "UPDATE task_runs SET status='failed'",
    "DELETE FROM report_articles",
    "UPDATE reports SET content_json=json_set(content_json,'$.items[0].source.canonicalUrl','https://evil.example/forged')",
  ]) {
    const s = fixture();
    try {
      const p = new PublicationService(s.db, target, {
        async publish() {
          assert.fail("must not call GitHub");
        },
      });
      s.db.exec(sql);
      assert.throws(() => p.approve("r", hash(p)));
    } finally {
      s.close();
    }
  }
  const s = fixture();
  try {
    const p = new PublicationService(s.db, target, {
      async publish() {
        assert.fail("must not call GitHub");
      },
    });
    p.approve("r", hash(p));
    s.db.exec("UPDATE reports SET title='changed'");
    await assert.rejects(p.publish("r"));
  } finally {
    s.close();
  }
});
test("restart marks in-flight publication retryable without claiming success", async () => {
  const s = fixture();
  try {
    const p = new PublicationService(s.db, target, {
      async publish() {
        return { sha: "c".repeat(40), committedAt: "2026-11-03T01:00:00Z" };
      },
    });
    p.approve("r", hash(p));
    await p.publish("r");
    s.db.exec(
      "UPDATE publication_records SET status='publishing',commit_sha=NULL",
    );
    new PublicationService(s.db, target, undefined);
    const row = p.inspect("r").publications[0];
    assert.equal(row.status, "failed");
    assert.equal(row.error_code, "publication_interrupted");
  } finally {
    s.close();
  }
});
test("credential rotation never changes publication identity", async () => {
  const s = fixture();
  let calls = 0;
  const adapter = {
    async publish() {
      calls++;
      return { sha: "d".repeat(40), committedAt: "2026-11-03T01:00:00Z" };
    },
  };
  try {
    const old = new PublicationService(
      s.db,
      { ...target, token: "old_secret" },
      adapter,
    );
    old.approve("r", hash(old));
    const first = await old.publish("r");
    const rotated = new PublicationService(
      s.db,
      { ...target, token: "new_secret" },
      adapter,
    );
    const second = await rotated.publish("r");
    assert.equal(second.id, first.id);
    assert.equal(calls, 1);
    assert.equal(rotated.inspect("r").publications.length, 1);
  } finally {
    s.close();
  }
});
test("concurrent publication is refused and shutdown abort is persisted as retryable failure", async () => {
  const s = fixture();
  try {
    const p = new PublicationService(s.db, target, {
      publish(_artifact, signal) {
        return new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(Error("stopped")), {
            once: true,
          }),
        );
      },
    });
    p.approve("r", hash(p));
    const pending = p.publish("r");
    await assert.rejects(p.publish("r"), /publication_busy/);
    await p.close();
    assert.equal((await pending).status, "failed");
    assert.equal(
      p.inspect("r").publications[0].error_code,
      "publication_interrupted",
    );
    await assert.rejects(p.publish("r"), /publisher_stopped/);
  } finally {
    s.close();
  }
});
test("new dates and revisions produce distinct immutable artifact paths", async () => {
  const s = fixture();
  const paths = [];
  try {
    const p = new PublicationService(s.db, target, {
      async publish(a) {
        paths.push(a.path);
        return { sha: "a".repeat(40), committedAt: "2026-11-03T01:00:00Z" };
      },
    });
    p.approve("r", hash(p));
    await p.publish("r");
    // Create independent, explicitly validated report revisions as the real workflow does.
    for (const [id, date, version] of [
      ["r2", "2026-11-03", 2],
      ["r3", "2026-11-04", 1],
    ]) {
      const doc = { ...s.doc, reportId: id, runId: id, reportDate: date };
      s.db
        .prepare(
          "INSERT INTO task_runs(id,task_id,idempotency_key,status) VALUES (?,'news-github',?,'succeeded')",
        )
        .run(id, id);
      s.db
        .prepare(
          "INSERT INTO reports(id,run_id,report_date,channel,version,title,body_markdown,content_json,status) VALUES (?,?,?,'opensource',?,?,'test',?,'validated')",
        )
        .run(id, id, date, version, doc.title, JSON.stringify(doc));
      s.db
        .prepare(
          "INSERT INTO report_articles(report_id,article_id,position) VALUES (?,'a',0)",
        )
        .run(id);
      const original = s.db
        .prepare("SELECT * FROM news_runs WHERE run_id='run'")
        .get();
      s.db
        .prepare(
          "INSERT INTO news_runs(run_id,source_id,report_date,channel,collected_at,candidates_json,report_id) VALUES (?,'github-blog',?,'opensource',?,?,?)",
        )
        .run(id, date, original.collected_at, original.candidates_json, id);
      p.approve(id, p.inspect(id).contentHash);
      await p.publish(id);
    }
    assert.deepEqual(paths, [
      "reports/2026/11/03/opensource/v000001.json",
      "reports/2026/11/03/opensource/v000002.json",
      "reports/2026/11/04/opensource/v000001.json",
    ]);
  } finally {
    s.close();
  }
});
