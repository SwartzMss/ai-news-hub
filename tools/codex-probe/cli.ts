import { resolve } from 'node:path';
import { runProbe, ProbeError } from './client.js';

const write = (event: object) => process.stdout.write(JSON.stringify(event) + '\n');
const controller = new AbortController();
process.once('SIGTERM', () => controller.abort());
process.once('SIGINT', () => controller.abort());
process.umask(0o077);

try {
  if (process.platform !== 'linux' || process.getuid?.() === 0) throw new ProbeError('non_root_linux_required');
  const timeoutMs = Number(process.env.PROBE_TIMEOUT_MS ?? 90000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 300000) throw new ProbeError('invalid_config');
  await runProbe({
    binary: process.env.CODEX_BIN ?? 'codex',
    cwd: resolve(process.env.PROBE_CWD ?? process.cwd()),
    model: process.env.CODEX_MODEL || undefined,
    timeoutMs, signal: controller.signal, log: write,
  });
} catch (error) {
  const code = error instanceof ProbeError ? error.code : 'internal_error';
  write({ timestamp: new Date().toISOString(), event: 'probe_failed', code });
  process.exitCode = code === 'cancelled' ? 130 : 1;
}
