// Fault injection only. This file must never be deployed as the real probe.
import { existsSync, writeFileSync } from 'node:fs';
import { runProbe } from '../../dist/tools/codex-probe/client.js';
let mode = process.argv[2];
if (mode === 'restart') {
  const marker = process.argv[3];
  mode = existsSync(marker) ? 'success' : 'exit';
  writeFileSync(marker, 'fixture-only', { mode: 0o600 });
}
const controller = new AbortController();
process.once('SIGTERM', () => controller.abort());
try {
  await runProbe({ binary: process.execPath, args: ['tests/fixtures/app-server.mjs', mode],
    cwd: process.cwd(), timeoutMs: 30000, signal: controller.signal,
    log: (event) => console.log(JSON.stringify({ fixture: true, ...event })),
  });
} catch { process.exitCode = 1; }
