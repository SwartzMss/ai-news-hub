import test from "node:test";
import assert from "node:assert/strict";
import { ReportRetentionScheduler, retentionCutoffDate } from "../dist/apps/server/src/publish/retention.js";

test("retention keeps 30 Shanghai calendar dates, including today", () => {
  assert.equal(retentionCutoffDate(new Date("2026-11-14T16:30:00.000Z")), "2026-10-17");
  assert.equal(retentionCutoffDate(new Date("2026-11-14T15:59:59.000Z")), "2026-10-16");
});

test("retention runs immediately, then daily at 03:00 Shanghai time", async () => {
  let now = new Date("2026-11-15T02:00:00.000Z");
  const cutoffs = [];
  const scheduler = new ReportRetentionScheduler({
    async removeExpiredBefore(cutoff) { cutoffs.push(cutoff); return 2; },
  }, () => now);
  try {
    assert.equal(await scheduler.tick(now), 2);
    assert.deepEqual(cutoffs, ["2026-10-17"]);
    assert.equal(await scheduler.tick(now), 0);
    now = new Date("2026-11-15T18:59:00.000Z");
    assert.equal(await scheduler.tick(now), 0);
    now = new Date("2026-11-15T19:00:00.000Z");
    assert.equal(await scheduler.tick(now), 2);
    assert.deepEqual(cutoffs, ["2026-10-17", "2026-10-18"]);
  } finally {
    await scheduler.close();
  }
});

test("retention retries a failed cleanup after 15 minutes", async () => {
  let now = new Date("2026-11-15T02:00:00.000Z");
  let attempts = 0;
  const scheduler = new ReportRetentionScheduler({
    async removeExpiredBefore() {
      attempts++;
      if (attempts === 1) throw new Error("temporary failure");
      return 1;
    },
  }, () => now);
  try {
    await assert.rejects(scheduler.tick(now), /temporary failure/);
    now = new Date(now.getTime() + 14 * 60 * 1000);
    assert.equal(await scheduler.tick(now), 0);
    assert.equal(attempts, 1);
    now = new Date(now.getTime() + 60 * 1000);
    assert.equal(await scheduler.tick(now), 1);
    assert.equal(attempts, 2);
  } finally {
    await scheduler.close();
  }
});

test("retention does not start new work after shutdown", async () => {
  let attempts = 0;
  const scheduler = new ReportRetentionScheduler({
    async removeExpiredBefore() { attempts++; return 1; },
  });
  scheduler.stop();
  assert.equal(await scheduler.tick(), 0);
  assert.equal(attempts, 0);
  await scheduler.close();
});
