export async function cleanupUserDb(db, now = Date.now()) {
  if (!db || !Number.isSafeInteger(now) || now < 0) throw Error('cleanup_unavailable');
  const idleCutoff = now - 7 * 86400000;
  return db.batch([
    db.prepare(`DELETE FROM auth_sessions WHERE id IN (
      SELECT id FROM auth_sessions WHERE expires_at<=? OR last_seen_at<=? OR revoked_at IS NOT NULL LIMIT 1000
    )`).bind(now, idleCutoff),
    db.prepare(`DELETE FROM auth_email_tokens WHERE id IN (
      SELECT id FROM auth_email_tokens WHERE expires_at<=? OR consumed_at IS NOT NULL LIMIT 1000
    )`).bind(now),
    db.prepare(`DELETE FROM auth_rate_limits WHERE key_hash IN (
      SELECT key_hash FROM auth_rate_limits WHERE expires_at<=? LIMIT 1000
    )`).bind(now),
  ]);
}
