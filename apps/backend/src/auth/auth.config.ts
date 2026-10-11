import { ConfigurationError } from '../config';

export function readAuthConfig(env: NodeJS.ProcessEnv) {
  const origin = env['ADMIN_ORIGIN'] ?? (env['NODE_ENV'] === 'production' ? '' : 'http://localhost:18432');
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new ConfigurationError('ADMIN_ORIGIN muss eine gueltige Origin sein.');
  }
  if (url.origin !== origin || url.username || url.password) {
    throw new ConfigurationError('ADMIN_ORIGIN muss ohne Pfad, Zugangsdaten oder abschliessenden Slash angegeben werden.');
  }
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !localHttp) {
    throw new ConfigurationError('ADMIN_ORIGIN benoetigt HTTPS; HTTP ist nur fuer localhost erlaubt.');
  }
  const secure = url.protocol === 'https:';
  return { origin, secure };
}
