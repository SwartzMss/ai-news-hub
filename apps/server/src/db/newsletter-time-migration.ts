export const newsletterTimeMigration = {
  version: 13,
  name: 'newsletter_start_time',
  sql: `
 ALTER TABLE newsletter_schedule ADD COLUMN local_time TEXT NOT NULL DEFAULT '09:00'
   CHECK (length(local_time)=5 AND local_time GLOB '[0-2][0-9]:[0-5][0-9]' AND substr(local_time,1,2)<='23');
 `,
};
