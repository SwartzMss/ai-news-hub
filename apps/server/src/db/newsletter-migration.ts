export const newsletterMigration = {
  version: 12,
  name: 'newsletter_scheduler',
  sql: `
 CREATE TABLE newsletter_schedule (
   id INTEGER PRIMARY KEY CHECK (id=1),
   enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
   next_run_at TEXT,
   updated_at TEXT NOT NULL
 ) STRICT;
 INSERT INTO newsletter_schedule(id,enabled,next_run_at,updated_at) VALUES(1,0,NULL,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 CREATE TABLE newsletter_dispatches (
   dispatch_id TEXT PRIMARY KEY NOT NULL,
   trigger_reason TEXT NOT NULL CHECK(trigger_reason IN ('scheduled','retry','manual')),
   scheduled_at TEXT NOT NULL,
   status TEXT NOT NULL CHECK(status IN ('pending','dispatching','queued','in_progress','succeeded','failed','dispatch_unknown')),
   attempt INTEGER NOT NULL CHECK(attempt BETWEEN 0 AND 4),
   dispatched_at TEXT,
   workflow_run_id INTEGER UNIQUE,
   run_url TEXT,
   html_url TEXT,
   last_checked_at TEXT,
   error_code TEXT,
   finished_at TEXT,
   created_at TEXT NOT NULL,
   updated_at TEXT NOT NULL
 ) STRICT;
 CREATE INDEX newsletter_dispatches_recent ON newsletter_dispatches(created_at DESC);
 `,
};
