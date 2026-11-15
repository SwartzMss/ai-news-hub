import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicationService } from '../dist/apps/server/src/publish/service.js';
import { publicationFixture as fixture } from './fixtures/publication.mjs';
const target = { repository: 'owner/archive', branch: 'reports' };
test('deletion retries remote failure, blocks republishing, detaches report and retains run and version', async () => {
  const s = fixture();
  let attempts = 0;
  const adapter = {
    async publish() { return { sha: 'a'.repeat(40), committedAt: '2026-11-03T01:00:00Z' }; },
    async remove(artifact, actualTarget) {
      assert.deepEqual(actualTarget, target);
      assert.equal(artifact.reportId, 'r');
      if (++attempts === 1) throw new Error('private error');
    },
  };
  const p = new PublicationService(s.db, target, adapter);
  try {
    p.approve('r', p.inspect('r').contentHash);
    await p.publish('r');
    await assert.rejects(p.remove('r'), /github_unavailable/);
    assert.ok(s.db.prepare("SELECT id FROM reports WHERE id='r'").get());
    await assert.rejects(p.publish('r'), /report_deleting/);
    await p.remove('r');
    assert.equal(s.db.prepare("SELECT id FROM reports WHERE id='r'").get(), undefined);
    assert.equal(s.db.prepare("SELECT count(*) n FROM task_runs").get().n, 1);
    assert.equal(s.db.prepare("SELECT count(*) n FROM report_articles").get().n, 0);
    assert.equal(s.db.prepare("SELECT report_id FROM news_runs").get().report_id, null);
    assert.equal(s.db.prepare("SELECT version,status FROM report_deletions WHERE report_id='r'").get().version, 1);
    await p.remove('r');
    assert.equal(attempts, 2);
  } finally { await p.close(); s.close(); }
});
test('unpublished reports can be deleted without GitHub configured', async () => {
  const s = fixture();
  const p = new PublicationService(s.db);
  try { await p.remove('r'); assert.equal(s.db.prepare('SELECT count(*) n FROM reports').get().n, 0); }
  finally { await p.close(); s.close(); }
});


test('retention deletes every expired report version in one remote batch and preserves run history', async () => {
  const s = fixture();
  const targetPath = (date, version) => "reports/topics/" + s.doc.topic.id + "/" + date + "/v" + String(version).padStart(6, "0") + ".json";
  const batches = [];
  const adapter = {
    async removeMany(artifacts, actualTarget) {
      batches.push({ artifacts, target: actualTarget });
    },
  };
  const publisher = new PublicationService(s.db, target, adapter);
  try {
    s.db.prepare("INSERT INTO publication_records(id,report_id,target,idempotency_key,status,artifact_path,repository,branch,content_hash) VALUES (?,'r','github',?,'succeeded',?,?,?,?)")
      .run("publication-r", "key-r", targetPath("2026/11/03", 1), target.repository, target.branch, "c".repeat(64));
    const extraReports = [
      { id: "expired-1", date: "2026-11-03", version: 2 },
      { id: "expired-2", date: "2026-11-02", version: 1 },
    ];
    for (const report of extraReports) {
      s.db.prepare("INSERT INTO reports(id,run_id,report_date,channel,version,title,body_markdown,content_json,status) VALUES (?,'run',?,'opensource',?,?,'test',?,'published')")
        .run(report.id, report.date, report.version, report.id, JSON.stringify(s.doc));
      s.db.prepare("INSERT INTO publication_records(id,report_id,target,idempotency_key,status,artifact_path,repository,branch,content_hash) VALUES (?,?,'github',?,'succeeded',?,?,?,?)")
        .run("publication-" + report.id, report.id, "key-" + report.id, targetPath(report.date.replaceAll("-", "/"), report.version), target.repository, target.branch, "a".repeat(64));
    }
    assert.equal(await publisher.removeExpiredBefore("2026-11-04"), 3);
    assert.equal(batches.length, 1);
    assert.equal(batches[0].artifacts.length, 3);
    assert.deepEqual(batches[0].target, target);
    assert.equal(s.db.prepare("SELECT count(*) n FROM reports").get().n, 0);
    assert.equal(s.db.prepare("SELECT count(*) n FROM report_deletions WHERE status='succeeded'").get().n, 3);
    assert.equal(s.db.prepare("SELECT count(*) n FROM task_runs").get().n, 1);
    assert.equal(s.db.prepare("SELECT report_id FROM news_runs").get().report_id, null);
    assert.equal(s.db.prepare("SELECT count(*) n FROM run_events WHERE kind='report_deleted'").get().n, 3);
  } finally {
    await publisher.close();
    s.close();
  }
});

test('retention keeps local reports when a remote batch fails and retries idempotently', async () => {
  const s = fixture();
  let attempts = 0;
  const adapter = {
    async removeMany() {
      if (++attempts === 1) throw new Error("temporary GitHub failure");
    },
  };
  const publisher = new PublicationService(s.db, target, adapter);
  try {
    const id = "expired";
    s.db.prepare("INSERT INTO reports(id,run_id,report_date,channel,version,title,body_markdown,content_json,status) VALUES (?,'run','2026-11-02','opensource',1,'expired','test',?,'published')")
      .run(id, JSON.stringify(s.doc));
    s.db.prepare("INSERT INTO publication_records(id,report_id,target,idempotency_key,status,artifact_path,repository,branch,content_hash) VALUES (?,?,'github',?,'succeeded',?,?,?,?)")
      .run("publication-expired", id, "key-expired", "reports/topics/" + s.doc.topic.id + "/2026/11/02/v000001.json", target.repository, target.branch, "b".repeat(64));
    await assert.rejects(publisher.removeExpiredBefore("2026-11-03"), /github_unavailable/);
    assert.ok(s.db.prepare("SELECT id FROM reports WHERE id=?").get(id));
    assert.equal(s.db.prepare("SELECT status FROM report_deletions WHERE report_id=?").get(id).status, "failed");
    assert.equal(await publisher.removeExpiredBefore("2026-11-03"), 1);
    assert.equal(attempts, 2);
    assert.equal(s.db.prepare("SELECT id FROM reports WHERE id=?").get(id), undefined);
  } finally {
    await publisher.close();
    s.close();
  }
});
