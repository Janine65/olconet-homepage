import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readAuthConfig } from '../src/auth/auth.config';
import { loginInput, normalizeEmail, validatePassword } from '../src/auth/auth.input';
import { hashPassword, verifyPassword } from '../src/auth/password';
import { sessionToken, tokenHash } from '../src/auth/auth.service';

test('Origin-Konfiguration erlaubt lokales HTTP und aktiviert Secure nur bei HTTPS', () => {
  assert.deepEqual(readAuthConfig({}), { origin: 'http://localhost:18432', secure: false });
  assert.deepEqual(readAuthConfig({ NODE_ENV: 'production', ADMIN_ORIGIN: 'https://admin.example.com' }),
    { origin: 'https://admin.example.com', secure: true });
  assert.equal(readAuthConfig({ ADMIN_ORIGIN: 'http://127.0.0.1:18432' }).secure, false);
  for (const origin of ['https://admin.example.com/', 'http://admin.example.com', 'https://admin.example.com/path',
    'https://user:password@admin.example.com', 'invalid']) {
    assert.throws(() => readAuthConfig({ ADMIN_ORIGIN: origin }));
  }
  assert.throws(() => readAuthConfig({ NODE_ENV: 'production' }));
});

test('Anmeldedaten werden begrenzt, Kontoadressen normalisiert und unbekannte Felder abgelehnt', () => {
  assert.equal(normalizeEmail(' Janine@Example.com '), 'janine@example.com');
  assert.deepEqual(loginInput({ email: 'User@Example.com', password: 'pw' }),
    { email: 'user@example.com', password: 'pw' });
  for (const value of [null, [], {}, { email: 'invalid', password: 'pw' },
    { email: 'user@example.com', password: '' }, { email: 'user@example.com', password: 'pw', role: 'admin' }]) {
    assert.throws(() => loginInput(value));
  }
  assert.throws(() => validatePassword('short', true));
  assert.equal(validatePassword('x'.repeat(128), true).length, 128);
  assert.throws(() => validatePassword('x'.repeat(129), true));
  assert.throws(() => validatePassword('\u00e4'.repeat(65)));
});

test('Passwort-Hashes sind gesalzen, pruefbar und Klartext wird nicht gespeichert', async () => {
  const password = 'Long-test-password!';
  const a = await hashPassword(password);
  const b = await hashPassword(password);
  assert.notEqual(a, b);
  assert.equal(a.includes(password), false);
  assert.equal(await verifyPassword(password, a), true);
  assert.equal(await verifyPassword('incorrect', a), false);
  assert.equal(await verifyPassword(password, null), false);
  await assert.rejects(verifyPassword(password, 'corrupted'));
});

test('Session-Cookies sind strikt und nur Token-Hashes werden persistiert', () => {
  const token = 'a'.repeat(43);
  assert.equal(sessionToken(`other=value; olconet_session=${token}`), token);
  assert.equal(tokenHash(token).length, 64);
  assert.notEqual(tokenHash(token), token);
  for (const cookie of [undefined, 'olconet_session=short',
    `olconet_session=${token}; olconet_session=${token}`, `olconet_session=${'%'.repeat(43)}`]) {
    assert.equal(sessionToken(cookie), null);
  }
});
