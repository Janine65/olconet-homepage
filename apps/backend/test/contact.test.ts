import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  consumeContactRateLimit, readContactSettings, validateContactMessage, verifyTurnstile,
} from '../src/contact.service';

test('Kontaktanfragen werden serverseitig validiert und begrenzt', () => {
  assert.deepEqual(validateContactMessage({
    name: ' Janine ', email: ' janine@example.com ', message: ' Hallo\nWelt ', turnstileToken: 'token',
  }), {
    name: 'Janine', email: 'janine@example.com', message: 'Hallo\nWelt', turnstileToken: 'token',
  });
  for (const value of [
    null,
    { name: '', email: 'janine@example.com', message: 'Hallo', turnstileToken: 'token' },
    { name: 'J\nan', email: 'janine@example.com', message: 'Hallo', turnstileToken: 'token' },
    { name: 'Janine', email: 'not-an-email', message: 'Hallo', turnstileToken: 'token' },
    { name: 'Janine', email: 'janine@example.com', message: ' '.repeat(5001), turnstileToken: 'token' },
  ]) assert.throws(() => validateContactMessage(value));
});

test('Turnstile-Token werden serverseitig mit Hostname und Aktion verifiziert', async () => {
  const settings = readContactSettings({
    TURNSTILE_SITE_KEY: 'site-test',
    TURNSTILE_SECRET_KEY: 'secret-test',
    CONTACT_RECIPIENT: 'janine@olconet.com',
    SMTP_HOST: 'mail.example.com',
    SMTP_PORT: '587',
    SMTP_USER: 'user',
    SMTP_PASSWORD: 'pass',
    SMTP_FROM: 'noreply@example.com',
  });
  const previousSiteUrl = process.env['SITE_URL'];
  process.env['SITE_URL'] = 'https://www.olconet.com';
  try {
    let requestBody: BodyInit | null | undefined;
    await verifyTurnstile('challenge-token', settings, async (input, init) => {
      assert.equal(input, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
      requestBody = init?.body;
      return Response.json({ success: true, action: 'contact', hostname: 'www.olconet.com' });
    });
    assert.ok(requestBody instanceof FormData);
    assert.equal(requestBody.get('response'), 'challenge-token');
    assert.equal(requestBody.get('secret'), 'secret-test');
    await assert.rejects(verifyTurnstile('challenge-token', settings, async () =>
      Response.json({ success: true, action: 'other', hostname: 'www.olconet.com' })));
  } finally {
    if (previousSiteUrl === undefined) delete process.env['SITE_URL'];
    else process.env['SITE_URL'] = previousSiteUrl;
  }
});

test('Kontaktformular begrenzt erfolgreiche Anfragen je E-Mail-Adresse und Zeitfenster', () => {
  const attempts = new Map<string, number[]>();
  consumeContactRateLimit(attempts, 'janine@example.com', 1000);
  consumeContactRateLimit(attempts, 'JANINE@example.com', 2000);
  consumeContactRateLimit(attempts, 'janine@example.com', 3000);
  assert.throws(() => consumeContactRateLimit(attempts, 'janine@example.com', 4000), error => {
    return error instanceof Error && 'getStatus' in error &&
      typeof error.getStatus === 'function' && error.getStatus() === 429;
  });
  assert.doesNotThrow(() => consumeContactRateLimit(attempts, 'janine@example.com', 15 * 60 * 1000 + 1001));
});
