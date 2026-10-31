import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { visitorHeaders, visitorProxyConfig } from './visitor-proxy.mjs';

const env = {
  VISITOR_PROXY_SECRET: 'test-only-visitor-secret-at-least-32-characters',
  VISITOR_TRUSTED_PROXIES: '192.168.1.200',
  VISITOR_EXCLUDED_IPS: '203.0.113.10,2001:db8::10',
};
const config = visitorProxyConfig(env);
const request = (peer, forwarded) => ({ socket: { remoteAddress: peer }, headers: { 'x-forwarded-for': forwarded } });

test('visitor proxy excludes local, LAN and configured home IP addresses', () => {
  for (const ip of ['127.0.0.1', '::1', '::ffff:192.168.1.5', '10.1.2.3', '172.17.0.1', 'fe80::1', 'fd00::1']) {
    assert.match(visitorHeaders(request(ip), config)['x-olconet-visitor-proof'], /:excluded$/);
  }
  for (const ip of ['203.0.113.10', '2001:db8::10']) {
    assert.match(visitorHeaders(request('192.168.1.200', ip), config)['x-olconet-visitor-proof'], /:excluded$/);
  }
});

test('only trusted immediate proxies can supply a single original client IP', () => {
  assert.match(visitorHeaders(request('127.0.0.1', '198.51.100.20'), config)['x-olconet-visitor-proof'], /:excluded$/);
  const result = visitorHeaders(request('::ffff:192.168.1.200', '198.51.100.20'), config);
  assert.match(result['x-olconet-visitor-proof'], /:external$/);
  assert.equal(result['x-olconet-visitor-signature'],
    createHmac('sha256', env.VISITOR_PROXY_SECRET).update(result['x-olconet-visitor-proof']).digest('hex'));
  for (const forwarded of [undefined, 'invalid', '203.0.113.10, 198.51.100.20']) {
    assert.deepEqual(visitorHeaders(request('192.168.1.200', forwarded), config), {});
  }
});

test('missing configuration disables counting; malformed configuration is rejected', () => {
  for (const key of Object.keys(env)) {
    assert.deepEqual(visitorHeaders(request('192.168.1.200', '198.51.100.20'), visitorProxyConfig({ ...env, [key]: '' })), {});
  }
  assert.throws(() => visitorProxyConfig({ ...env, VISITOR_TRUSTED_PROXIES: 'not-an-ip' }));
  assert.throws(() => visitorProxyConfig({ ...env, VISITOR_PROXY_SECRET: 'short' }));
});
