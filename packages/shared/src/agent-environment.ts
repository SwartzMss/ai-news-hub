// Model authentication belongs to Codex; Backend/admin/publishing credentials do
// not. Preserve only runtime, locale, proxy and explicit model-auth variables.
export function codexEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const allowed = new Set([
    'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'TZ', 'TMPDIR',
    'CODEX_HOME', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL', 'ACCESS_TOKEN',
    'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy',
    'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY',
    'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS',
    'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS',
  ]);
  return Object.fromEntries(Object.entries(source).filter(([key]) => allowed.has(key) || key.startsWith('LC_')));
}
