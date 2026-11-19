export interface MailPayload {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

export class MailError extends Error {
  constructor(public code: string) { super(code); }
}

/** Shared Resend transport. Callers own feature flags, sender validation and retries. */
export async function sendMail(
  config: { apiKey: string }, payload: MailPayload, idempotencyKey: string, fetcher: typeof fetch = fetch,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetcher('https://api.resend.com/emails', {
      method: 'POST', redirect: 'manual', signal: controller.signal,
      headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify(payload),
    });
    if (!response.ok) { await response.body?.cancel(); throw new MailError(`mail_http_${response.status}`); }
    const reader = response.body?.getReader();
    let text = '';
    if (reader) for (;;) {
      const item = await reader.read();
      if (item.done) break;
      text += new TextDecoder().decode(item.value);
      if (text.length > 8192) { await reader.cancel(); throw Error(); }
    }
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || typeof (value as { id?: unknown }).id !== 'string') throw Error();
    const id = (value as { id: string }).id;
    if (!id || id.length > 128) throw Error();
    return id;
  } catch (error) {
    if (error instanceof MailError) throw error;
    throw new MailError(controller.signal.aborted ? 'mail_timeout' : 'mail_unavailable');
  } finally { clearTimeout(timer); }
}
