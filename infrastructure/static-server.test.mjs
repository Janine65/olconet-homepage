import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer, get } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createStaticServer } from './static-server.mjs';

test('static server serves pages without exposing private files', async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'olconet-static-test-'));
  const root = join(temp, 'public');
  await mkdir(join(root, 'reisen'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<h1>olconet</h1>');
  await writeFile(join(root, 'reisen', 'index.html'), '<h1>Reisen</h1>');
  await writeFile(join(root, '.env'), 'private');
  await writeFile(join(temp, 'private.txt'), 'private');
  await symlink(join(temp, 'private.txt'), join(root, 'linked.txt'));
  const server = await createStaticServer(root);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(temp, { recursive: true });
  });

  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/', '/reisen/', '/health/live', '/health/ready']) {
    assert.equal((await fetch(`${base}${path}`)).status, 200, path);
  }
  const page = await fetch(base);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.equal(await page.text(), '<h1>olconet</h1>');
  const head = await fetch(base, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), '16');
  assert.equal(await head.text(), '');
  for (const path of ['/.env', '/linked.txt', '/missing']) {
    assert.equal((await fetch(`${base}${path}`)).status, 404, path);
  }
  assert.equal((await fetch(base, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${base}/%ZZ`)).status, 400);
  const traversalStatus = await new Promise((resolve, reject) => {
    get(`${base}/%2e%2e%2fprivate.txt`, (response) => {
      response.resume();
      resolve(response.statusCode);
    }).on('error', reject);
  });
  assert.equal(traversalStatus, 404);
});

test('admin proxy forwards login, cookies and origin only to its configured backend', async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'olconet-proxy-test-'));
  await writeFile(join(temp, 'index.html'), '<h1>Admin</h1>');
  const backend = createServer(async (request, response) => {
    assert.equal(request.url, '/api/auth/login?test=1');
    assert.equal(request.headers.origin, 'http://localhost:18432');
    assert.equal(request.headers['x-olconet-request'], '1');
    assert.equal(request.headers.cookie, 'olconet_session=old');
    assert.equal(request.headers['x-forwarded-host'], undefined);
    let body = '';
    for await (const chunk of request) body += chunk;
    assert.equal(body, '{"email":"test@example.com","password":"test"}');
    response.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': ['olconet_session=new; Path=/api; HttpOnly; SameSite=Strict'],
    });
    response.end('{"user":{"email":"test@example.com"}}');
  });
  backend.listen(0, '127.0.0.1');
  await once(backend, 'listening');
  const proxy = await createStaticServer(temp, `http://127.0.0.1:${backend.address().port}`);
  const homepage = await createStaticServer(temp, `http://127.0.0.1:${backend.address().port}`, '/api/public/');
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  homepage.listen(0, '127.0.0.1');
  await once(homepage, 'listening');
  t.after(async () => {
    await new Promise((resolve) => proxy.close(resolve));
    await new Promise((resolve) => homepage.close(resolve));
    if (backend.listening) await new Promise((resolve) => backend.close(resolve));
    await rm(temp, { recursive: true });
  });
  const base = `http://127.0.0.1:${proxy.address().port}`;
  const response = await fetch(`${base}/api/auth/login?test=1`, {
    method: 'POST',
    headers: {
      Origin: 'http://localhost:18432',
      'X-Olconet-Request': '1',
      'Content-Type': 'application/json',
      Cookie: 'olconet_session=old',
      'X-Forwarded-Host': 'foreign.example',
    },
    body: '{"email":"test@example.com","password":"test"}',
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { user: { email: 'test@example.com' } });
  const homepageBase = `http://127.0.0.1:${homepage.address().port}`;
  assert.equal((await fetch(`${homepageBase}/api/admin/reports`)).status, 404);
  assert.equal((await fetch(`${homepageBase}/api/auth/me`)).status, 404);
  assert.equal((await fetch(`${homepageBase}/api/public/../admin/reports`)).status, 404);
  await new Promise((resolve) => backend.close(resolve));
  const unavailable = await fetch(`${base}/api/auth/me`);
  assert.equal(unavailable.status, 502);
  assert.deepEqual(await unavailable.json(), { message: 'Backend nicht erreichbar.' });
  assert.equal((await fetch(`${base}/`)).status, 200);
  await assert.rejects(createStaticServer(temp, 'http://backend/path'));
  await assert.rejects(createStaticServer(temp, 'file:///tmp'));
});
