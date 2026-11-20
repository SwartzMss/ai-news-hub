const endpoint = ({ accountId, databaseId }) => {
  if (!/^[0-9a-f]{32}$/i.test(accountId) || !/^[0-9a-f-]{36}$/i.test(databaseId)) throw Error('backup_export_failed');
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/export`;
};

async function callExport(config, payload, fetcher) {
  const response = await fetcher(endpoint(config), { method: 'POST', headers: {
    Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!response.ok) throw Error('backup_export_failed');
  const body = await response.json().catch(() => null);
  if (!body?.success || !body.result || body.result.error) throw Error('backup_export_failed');
  return body.result;
}

export async function startExport(config, fetcher = fetch) {
  const result = await callExport(config, { output_format: 'polling' }, fetcher);
  if (typeof result.at_bookmark !== 'string' || !result.at_bookmark) throw Error('backup_export_failed');
  return result.at_bookmark;
}

export async function pollExport(config, bookmark, fetcher = fetch) {
  if (typeof bookmark !== 'string' || !bookmark) throw Error('backup_export_failed');
  const result = await callExport(config, { output_format: 'polling', current_bookmark: bookmark }, fetcher);
  if (result.status === 'error') throw Error('backup_export_failed');
  const dump = result.result ?? result;
  if (result.status !== 'complete' && !dump.signed_url) return { ready: false };
  if (typeof dump.signed_url !== 'string' || typeof dump.filename !== 'string' || !dump.filename) throw Error('backup_export_failed');
  let url;
  try { url = new URL(dump.signed_url); } catch { throw Error('backup_export_failed'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw Error('backup_export_failed');
  return { ready: true, url: url.href, filename: dump.filename };
}

export async function storeExport(exportResult, bucket, key, fetcher = fetch) {
  if (!exportResult?.ready || !/^backups\/\d{4}-\d{2}-\d{2}\/[a-zA-Z0-9_.-]+\.sql$/.test(key)) throw Error('backup_export_failed');
  const response = await fetcher(exportResult.url, { redirect: 'error' });
  if (!response.ok || !response.body) throw Error('backup_export_failed');
  const saved = await bucket.put(key, response.body, { httpMetadata: { contentType: 'application/sql' } });
  if (!saved) throw Error('backup_export_failed');
  return key;
}
