// Read-only compatibility for reports created before Codex topic research.
// No feed URL or collector is retained in the runtime.
export function legacySourceUrl(raw: string): string {
  if (typeof raw !== 'string' || raw.length > 2048 || [...raw].some(c=>c.charCodeAt(0)<=32 || c.charCodeAt(0)===127)) throw Error('invalid legacy source');
  const url = new URL(raw);
  if (!['http:','https:'].includes(url.protocol) || url.hostname !== 'github.blog' || url.username || url.password || url.port) throw Error('invalid legacy source');
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key) || ['fbclid','gclid'].includes(key.toLowerCase())) url.searchParams.delete(key);
  url.searchParams.sort(); return url.href;
}
