import { buildServer } from './app.js';
import { loadConfig } from './config.js';
import { assertServiceUser, errorCode } from './errors.js';

process.umask(0o077);
let app: ReturnType<typeof buildServer> | undefined;
let stage = 'configuration';
let stopping = false;

async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => {
    process.stderr.write(JSON.stringify({ event: 'shutdown_failed', code: 'shutdown_timeout' }) + '\n');
    process.exit(1);
  }, 8000);
  deadline.unref();
  try {
    await app?.close();
    app?.log.info({ event: 'server_stopped' }, 'server_stopped');
  } catch {
    process.exitCode = 1;
  } finally { clearTimeout(deadline); }
}

try {
  assertServiceUser();
  const config = loadConfig();
  stage = 'database';
  app = buildServer(config);
  stage = 'listen';
  process.once('SIGTERM', () => { void shutdown(); });
  process.once('SIGINT', () => { void shutdown(); });
  const address = await app.listen({ host: config.host, port: config.port });
  app.log.info({ event: 'server_ready', address }, 'server_ready');
} catch (error) {
  process.stderr.write(JSON.stringify({ event: 'startup_failed', stage, code: errorCode(error) }) + '\n');
  process.exitCode = 1;
  await shutdown();
}
