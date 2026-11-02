import { loadConfig } from '../apps/server/src/config.js';

try {
  const config = loadConfig();
  const host = config.host === '::1' ? '[::1]' : config.host;
  const response = await fetch(`http://${host}:${config.port}/health`, {
    signal: AbortSignal.timeout(3000), redirect: 'error',
  });
  const body = await response.json() as { status?: string; database?: string };
  if (!response.ok || body.status !== 'ok' || body.database !== 'ok') throw new Error('unhealthy');
  process.stdout.write(JSON.stringify({ status: 'ok', database: 'ok' }) + '\n');
} catch {
  process.stderr.write(JSON.stringify({ status: 'error', code: 'health_check_failed' }) + '\n');
  process.exitCode = 1;
}
