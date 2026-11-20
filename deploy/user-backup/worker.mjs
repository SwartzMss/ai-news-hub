import { WorkflowEntrypoint } from 'cloudflare:workers';
import { startExport, pollExport, storeExport } from './export.mjs';
import { cleanupUserDb } from './cleanup.mjs';

export class UserBackupWorkflow extends WorkflowEntrypoint {
  async run(_event, step) {
    const config = { accountId: this.env.ACCOUNT_ID, databaseId: this.env.DATABASE_ID,
      token: this.env.D1_EXPORT_TOKEN };
    const bookmark = await step.do('start D1 export', () => startExport(config));
    let dump;
    for (let attempt = 0; attempt < 30; attempt++) {
      dump = await step.do(`poll D1 export ${attempt + 1}`, () => pollExport(config, bookmark));
      if (dump.ready) break;
      await step.sleep(`wait for D1 export ${attempt + 1}`, '10 seconds');
    }
    if (!dump?.ready) throw Error('backup_export_timed_out');
    const key = await step.do('choose private backup path', () => {
      const day = new Date().toISOString().slice(0, 10);
      return `backups/${day}/${crypto.randomUUID()}.sql`;
    });
    await step.do('save D1 export to private R2', () => storeExport(dump, this.env.USER_BACKUP_BUCKET, key));
  }
}

export default {
  fetch() { return new Response('Not found', { status: 404 }); },
  async scheduled(_event, env) { await cleanupUserDb(env.USER_DB); },
};
