import { createHmac } from 'node:crypto';
import { BlockList, isIP } from 'node:net';

export function normalizeIp(ip) {
  return ip?.startsWith('::ffff:') ? ip.slice(7) : ip;
}

export function visitorProxyConfig(env) {
  const addresses = (key) => (env[key] ?? '').split(',').map(value => normalizeIp(value.trim())).filter(Boolean);
  const trusted = addresses('VISITOR_TRUSTED_PROXIES');
  const excluded = addresses('VISITOR_EXCLUDED_IPS');
  for (const ip of [...trusted, ...excluded]) {
    if (!isIP(ip)) throw new Error('Visitor proxy configuration requires valid IP addresses');
  }
  const secret = env.VISITOR_PROXY_SECRET ?? '';
  if (secret && secret.length < 32) throw new Error('VISITOR_PROXY_SECRET must contain at least 32 characters');
  const local = new BlockList();
  for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16]]) {
    local.addSubnet(address, prefix, 'ipv4');
  }
  local.addAddress('::', 'ipv6');
  local.addAddress('::1', 'ipv6');
  local.addSubnet('fc00::', 7, 'ipv6');
  local.addSubnet('fe80::', 10, 'ipv6');
  return { trusted, excluded, secret, local };
}

export function visitorHeaders(request, config) {
  if (!config.secret || !config.excluded.length || !config.trusted.length) return {};
  const peer = normalizeIp(request.socket.remoteAddress);
  // Only a configured immediate proxy may supply the original client address.
  const forwarded = request.headers['x-forwarded-for'];
  if (config.trusted.includes(peer) && (typeof forwarded !== 'string' || forwarded.includes(','))) return {};
  const ip = config.trusted.includes(peer) && typeof forwarded === 'string'
    ? normalizeIp(forwarded.trim()) : peer;
  if (!isIP(ip)) return {};
  const excluded = config.excluded.includes(ip) || config.local.check(ip, isIP(ip) === 4 ? 'ipv4' : 'ipv6');
  const proof = `${Date.now()}:${excluded ? 'excluded' : 'external'}`;
  return {
    'x-olconet-visitor-proof': proof,
    'x-olconet-visitor-signature': createHmac('sha256', config.secret).update(proof).digest('hex'),
  };
}
