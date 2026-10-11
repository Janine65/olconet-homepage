export class ConfigurationError extends Error {}

export function readConfig(env: NodeJS.ProcessEnv) {
  const databaseUrl = env['DATABASE_URL'];
  if (!databaseUrl) throw new ConfigurationError('DATABASE_URL muss gesetzt sein.');
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new ConfigurationError('DATABASE_URL muss eine gueltige PostgreSQL-URL sein.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.pathname.length < 2) {
    throw new ConfigurationError('DATABASE_URL muss auf eine benannte PostgreSQL-Datenbank zeigen.');
  }
  const port = Number(env['PORT'] ?? '18433');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigurationError('PORT muss eine ganze Zahl zwischen 1 und 65535 sein.');
  }
  return { databaseUrl, port };
}
