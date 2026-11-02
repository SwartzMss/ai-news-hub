import { loadConfig } from './config.js';
import { openDatabase } from './db/database.js';
import { assertServiceUser, errorCode } from './errors.js';

process.umask(0o077);
try {
  assertServiceUser();
  const db = openDatabase(loadConfig().dataDir);
  db.close();
  process.stdout.write(JSON.stringify({ event: 'migrations_current' }) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({ event: 'migration_failed', code: errorCode(error) }) + '\n');
  process.exitCode = 1;
}
