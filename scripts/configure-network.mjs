#!/usr/bin/env node
import {lstatSync,mkdirSync,mkdtempSync,writeFileSync,renameSync,rmSync} from 'node:fs';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

function proxyUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash)
      throw Error();
  } catch {
    throw Error('Use an HTTP or HTTPS proxy URL with URL-encoded credentials and no path, query or fragment');
  }
  return value;
}

function environmentValue(value) {
  if (/[\r\n\0]/.test(value)) throw Error('Network settings cannot contain line breaks or null bytes');
  // Both systemd EnvironmentFile and Node --env-file support literal single quotes.
  if (!value.includes("'")) return "'" + value + "'";
  if (/["\\]/.test(value)) throw Error('URL-encode quotes and backslashes in network settings');
  return '"' + value + '"';
}

export function writeNetworkEnvironment(output, source = process.env) {
  if (!isAbsolute(output)) throw Error('Network environment file must use an absolute path');
  const fallback = source.all_proxy || source.ALL_PROXY;
  const http = source.http_proxy || source.HTTP_PROXY || fallback;
  const https = source.https_proxy || source.HTTPS_PROXY || http;
  if (!http && !https) throw Error('No proxy is configured in the current user environment');
  const noProxy = [...new Set([
    ...(source.no_proxy || source.NO_PROXY || '').split(',').map(value => value.trim()).filter(Boolean),
    'localhost', '127.0.0.1', '::1',
  ])].join(',');
  const network = {NO_PROXY: noProxy, no_proxy: noProxy};
  if (http) { network.HTTP_PROXY = proxyUrl(http); network.http_proxy = http; }
  if (https) { network.HTTPS_PROXY = proxyUrl(https); network.https_proxy = https; }
  const content = Object.entries(network).map(([key, value]) => key + '=' + environmentValue(value)).join('\n') + '\n';
  try {
    if (!lstatSync(output).isFile()) throw Error('Existing network environment file must be a regular file');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  mkdirSync(dirname(output), {recursive: true, mode: 0o700});
  const temporary = mkdtempSync(join(dirname(output), '.network-env-'));
  try {
    const staged = join(temporary, 'network.env');
    writeFileSync(staged, content, {mode: 0o600, flag: 'wx'});
    renameSync(staged, output);
  } finally {
    rmSync(temporary, {recursive: true, force: true});
  }
  return Object.keys(network);
}

function main() {
  const {values} = parseArgs({options: {output: {type: 'string'}, help: {type: 'boolean'}}});
  if (values.help) {
    console.log('Usage: npm run network:configure -- [--output /absolute/path/network.env]');
    console.log('Copies current user proxy settings into DATA_DIR/network.env with mode 0600. Re-running replaces that file.');
    return;
  }
  if (process.platform !== 'linux' || process.getuid() === 0)
    throw Error('Run network configuration as the non-root Linux service user');
  const dataDir = process.env.AI_NEWS_HUB_DATA_DIR || '/var/lib/ai-news-hub';
  if (!isAbsolute(dataDir)) throw Error('AI_NEWS_HUB_DATA_DIR must be an absolute path');
  const output = values.output || join(dataDir, 'network.env');
  const keys = writeNetworkEnvironment(output);
  console.log('Saved private network environment at ' + output + ' (0600).');
  console.log('Configured variables: ' + keys.join(', ') + '.');
  console.log('Use npm start -- --network-env-file ' + output + ' for manual startup.');
  console.log('For systemd, install with --extra-env-file ' + output + ', then restart the service.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) {
    console.error('Network configuration failed: ' + error.message);
    process.exitCode = 1;
  }
}
