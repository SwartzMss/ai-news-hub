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
