// Configuracao de CORS extraida do server.js (comportamento identico).
// Sem CORS_ORIGIN definido => libera todas as origens. Em dev, libera localhost.
function normalizeOrigin(value) {
  const input = String(value || '').trim();
  if (!input) return '';

  try {
    const parsed = new URL(input);
    const port = parsed.port ? `:${parsed.port}` : '';
    return `${parsed.protocol}//${parsed.hostname}${port}`.toLowerCase();
  } catch {
    return input.replace(/\/+$/, '').toLowerCase();
  }
}

function buildCorsOptions() {
  const configuredOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((item) => normalizeOrigin(item)).filter(Boolean)
    : [];

  const allowAllOrigins = configuredOrigins.length === 0;
  const isDev = process.env.NODE_ENV !== 'production';
  const localhostOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

  return {
    origin(origin, callback) {
      if (!origin || allowAllOrigins) {
        return callback(null, true);
      }

      const normalizedOrigin = normalizeOrigin(origin);
      const isConfigured = configuredOrigins.includes(normalizedOrigin);
      const isLocalDevOrigin = isDev && localhostOriginPattern.test(normalizedOrigin);

      if (isConfigured || isLocalDevOrigin) {
        return callback(null, true);
      }

      return callback(new Error(`Origem bloqueada pelo CORS: ${origin}`));
    },
  };
}

module.exports = { normalizeOrigin, buildCorsOptions };
