import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import {
  classifyReferrer, validateDuration, validatePagePath, visitorProfile, visitorProof,
} from '../src/visitors.controller';
import { visitorDateRange } from '../src/visitor-analytics.service';
import { visitorTrackingEnabled } from '../src/visitor-config';

test('Besuchsquellen werden als direkt, Suche oder Verweis eingeordnet', () => {
  assert.equal(classifyReferrer('', 'https://www.olconet.com'), 'direct');
  assert.equal(classifyReferrer('https://www.olconet.com/reisen/', 'https://www.olconet.com'), 'direct');
  assert.equal(classifyReferrer('https://www.google.com/search?q=trip', 'https://www.olconet.com'), 'search');
  assert.equal(classifyReferrer('https://example.org/article', 'https://www.olconet.com'), 'referral');
  assert.equal(classifyReferrer('javascript:alert(1)', 'https://www.olconet.com'), 'direct');
});

test('Seitenpfade und Besuchsdauer werden auf sichere Grenzen beschränkt', () => {
  assert.equal(validatePagePath('/en/kontakt/'), '/en/kontakt/');
  for (const path of ['//example.org/', '/path?email=x', '/path#hash', '/bad\\path', 'relative']) {
    assert.throws(() => validatePagePath(path));
  }
  assert.equal(validateDuration(1800), 1800);
  for (const duration of [-1, 1801, 1.5, '5']) assert.throws(() => validateDuration(duration));
});

test('Browser- und Gerätetyp werden ohne vollständigen User-Agent gespeichert', () => {
  assert.deepEqual(visitorProfile('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1'),
    { browser: 'Safari', device: 'mobile' });
  assert.deepEqual(visitorProfile('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36'),
    { browser: 'Chrome', device: 'desktop' });
  assert.deepEqual(visitorProfile(undefined), { browser: 'unknown', device: 'unknown' });
});

test('Proxy-Signatur bindet die echte Client-IP ein und vertraut keinen gefälschten Headern', () => {
  const secret = 'test-only-visitor-secret-at-least-32-characters';
  const proof = `${Date.now()}:external`;
  const ip = '198.51.100.20';
  const signature = createHmac('sha256', secret).update(`${proof}\n${ip}`).digest('hex');
  assert.deepEqual(visitorProof({
    'x-olconet-visitor-proof': proof,
    'x-olconet-visitor-ip': ip,
    'x-olconet-visitor-signature': signature,
  }, secret), { kind: 'external', ip });
  assert.equal(visitorProof({
    'x-olconet-visitor-proof': proof,
    'x-olconet-visitor-ip': '198.51.100.21',
    'x-olconet-visitor-signature': signature,
  }, secret), null);
});

test('Besuchserfassung benötigt produktive Proxy-Konfiguration', () => {
  const required = {
    NODE_ENV: 'production',
    VISITOR_PROXY_SECRET: 'test-only-visitor-secret-at-least-32-characters',
    VISITOR_TRUSTED_PROXIES: '192.168.1.200',
    VISITOR_EXCLUDED_IPS: '203.0.113.10',
  };
  assert.equal(visitorTrackingEnabled(required), true);
  assert.equal(visitorTrackingEnabled({ ...required, VISITOR_EXCLUDED_IPS: '' }), true);
  assert.equal(visitorTrackingEnabled({
    NODE_ENV: 'development', PUBLIC_VISITOR_TRACKING_TEST_MODE: 'true',
  }), true);
  assert.equal(visitorTrackingEnabled({
    PUBLIC_VISITOR_TRACKING_TEST_MODE: 'true',
  }), true);
  assert.equal(visitorTrackingEnabled({
    NODE_ENV: 'production', PUBLIC_VISITOR_TRACKING_TEST_MODE: 'true',
  }), false);
  assert.equal(visitorTrackingEnabled({
    NODE_ENV: 'test', PUBLIC_VISITOR_TRACKING_TEST_MODE: 'true',
  }), false);
  assert.equal(visitorTrackingEnabled({ ...required, VISITOR_PROXY_SECRET: '' }), false);
  assert.equal(visitorTrackingEnabled({ ...required, NODE_ENV: 'development' }), false);
  assert.equal(visitorTrackingEnabled({ ...required, VISITOR_TRUSTED_PROXIES: '' }), false);
});

test('Datumsfilter erlaubt hoechstens 365 Tage und keine Zukunftsdaten', () => {
  const now = new Date('2026-11-15T10:00:00.000Z');
  assert.deepEqual(visitorDateRange('2026-11-01', '2026-11-15', now), {
    from: '2026-11-01', to: '2026-11-15',
    start: new Date('2026-11-01T00:00:00.000Z'), end: new Date('2026-11-16T00:00:00.000Z'),
  });
  assert.throws(() => visitorDateRange('2025-11-14', '2026-11-15', now));
  assert.throws(() => visitorDateRange('2026-11-16', '2026-11-15', now));
  assert.throws(() => visitorDateRange('2026-11-01', '2026-11-16', now));
});
