export function safeReturnPath(input: string | null, origin: string): string | null {
  if (!input || input.length > 2048 || !input.startsWith("/") || input.startsWith("//")
    // eslint-disable-next-line no-control-regex
    || /[\\\u0000-\u001f\u007f]/u.test(input) || /%2f|%5c|%0[ad]/iu.test(input)) return null;
  try {
    const url = new URL(input, origin);
    if (url.origin !== origin || url.pathname.startsWith("/api/")
      || /^\/account\/(?:login|register|forgot-password)\/?$/u.test(url.pathname)) return null;
    return url.pathname + url.search + url.hash;
  } catch { return null; }
}
