import { appendFile, readFile, readdir, stat } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function deletionSql(tombstones) {
  if (!Array.isArray(tombstones)) throw Error('invalid_tombstones');
  const ids = new Set();
  for (const item of tombstones) {
    if (!item || item.schemaVersion !== 1 || typeof item.userId !== 'string' || !UUID.test(item.userId)
      || typeof item.deletedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(item.deletedAt)
      || Number.isNaN(Date.parse(item.deletedAt))) throw Error('invalid_tombstones');
    ids.add(item.userId.toLowerCase());
  }
  const values = [...ids];
  const statements = [];
  for (let start = 0; start < values.length; start += 500) {
    statements.push(`DELETE FROM users WHERE id IN (${values.slice(start, start + 500).map(id => `'${id}'`).join(',')});`);
  }
  return `\nPRAGMA foreign_keys = ON;\n${statements.join('\n')}${statements.length ? '\n' : ''}`;
}

export function prepareRestoreSql(backupSql, tombstones) {
  if (typeof backupSql !== 'string' || !backupSql.trim()) throw Error('invalid_backup');
  return backupSql + deletionSql(tombstones);
}

async function main(args) {
  const options = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (!['--backup', '--tombstones', '--output'].includes(args[i]) || !args[i + 1] || options.has(args[i])) throw Error('usage: --backup dump.sql --tombstones dir --output restore.sql');
    options.set(args[i], resolve(args[i + 1]));
  }
  if (options.size !== 3 || options.get('--backup') === options.get('--output')) throw Error('usage: --backup dump.sql --tombstones dir --output restore.sql');
  const files = (await readdir(options.get('--tombstones'))).sort();
  const tombstones = [];
  for (const name of files) {
    if (!name.endsWith('.json') || !UUID.test(name.slice(0, -5))) throw Error('invalid_tombstone_file');
    const path = join(options.get('--tombstones'), name);
    if (!(await stat(path)).isFile()) throw Error('invalid_tombstone_file');
    const item = JSON.parse(await readFile(path, 'utf8'));
    if (item.userId.toLowerCase() !== name.slice(0, -5).toLowerCase()) throw Error('invalid_tombstone_file');
    tombstones.push(item);
  }
  const suffix = deletionSql(tombstones);
  await pipeline(createReadStream(options.get('--backup')), createWriteStream(options.get('--output'), { flags: 'wx', mode: 0o600 }));
  await appendFile(options.get('--output'), suffix);
  process.stdout.write(JSON.stringify({ output: options.get('--output'), tombstones: tombstones.length }) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`restore_preparation_failed: ${error instanceof Error ? error.message : 'unknown'}\n`); process.exitCode = 1; }
}
