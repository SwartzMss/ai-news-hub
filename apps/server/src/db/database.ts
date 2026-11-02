import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AppError } from '../errors.js';
import { migrate } from './migrations.js';

export function openDatabase(dataDir: string): DatabaseSync {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const directory = lstatSync(dataDir);
  if (!directory.isDirectory() || directory.uid !== process.getuid?.() || (directory.mode & 0o077) !== 0) {
    throw new AppError('unsafe_data_permissions');
  }
  const dbPath = join(dataDir, 'news.db');
  const fd = openSync(dbPath, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  try {
    const file = fstatSync(fd);
    if (!file.isFile() || file.uid !== process.getuid?.() || (file.mode & 0o077) !== 0) throw new AppError('unsafe_data_permissions');
  } finally { closeSync(fd); }
  const db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true, allowExtension: false });
  try {
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    migrate(db);
    return db;
  } catch (error) { db.close(); throw error; }
}
