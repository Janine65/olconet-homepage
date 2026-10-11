import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function isInside(root, path) {
  const child = relative(root, path);
  return child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function proxyApi(request, response, target) {
  const excluded = new Set([
    'host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'te',
    'trailer', 'proxy-authorization', 'proxy-authenticate',
    ...String(request.headers.connection ?? '').split(',').map((header) => header.trim().toLowerCase()),
  ]);
  const headers = Object.fromEntries(Object.entries(request.headers)
    .filter(([name]) => !excluded.has(name) && !name.startsWith('x-forwarded-')));
  const upstream = (target.protocol === 'https:' ? httpsRequest : httpRequest)({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port,
    method: request.method,
    path: request.url,
    headers,
    timeout: 10000,
  }, (backend) => {
    const responseHeaders = Object.fromEntries(Object.entries(backend.headers)
      .filter(([name]) => !excluded.has(name)));
    response.writeHead(backend.statusCode ?? 502, { ...responseHeaders, 'Cache-Control': 'no-store' });
    backend.on('error', () => response.destroy());
    backend.pipe(response);
  });
  upstream.on('timeout', () => upstream.destroy(new Error('API timeout')));
  upstream.on('error', () => {
    console.error('API proxy request failed; backend availability must be checked.');
    if (response.headersSent) response.destroy();
    else {
      response.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ message: 'Backend nicht erreichbar.' }));
    }
  });
  request.on('aborted', () => upstream.destroy());
  response.on('close', () => upstream.destroy());
  request.pipe(upstream);
}

export async function createStaticServer(directory, apiUrl, apiPrefix = '/api/') {
  const root = await realpath(directory);
  const target = apiUrl ? new URL(apiUrl) : null;
  if (target && (!['http:', 'https:'].includes(target.protocol) || target.pathname !== '/' ||
    target.username || target.password || target.search || target.hash)) {
    throw new Error('API_PROXY_URL must be an HTTP(S) origin without credentials or path');
  }
  if (!['/api/', '/api/public/'].includes(apiPrefix)) throw new Error('Invalid API_PROXY_PREFIX');
  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('X-Frame-Options', 'DENY');
    if (target && request.url?.startsWith(apiPrefix)) {
      proxyApi(request, response, target);
      return;
    }
    const send = (status, body) => {
      response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.setHeader('Allow', 'GET, HEAD');
      send(405, 'Method not allowed');
      return;
    }
    try {
      const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (path === '/health/live' || path === '/health/ready') {
        send(200, 'ok');
        return;
      }
      if (path.includes('\0') || path.split('/').some((part) => part.startsWith('.'))) {
        send(404, 'Not found');
        return;
      }
      let file = resolve(root, `.${path}`);
      if (!isInside(root, file)) { send(404, 'Not found'); return; }
      if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
      file = await realpath(file);
      if (!isInside(root, file)) { send(404, 'Not found'); return; }
      const body = await readFile(file);
      response.writeHead(200, {
        'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream',
        'Content-Length': body.length,
        'Cache-Control': 'no-cache',
      });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch (error) {
      if (error instanceof URIError || error instanceof TypeError) {
        send(400, 'Bad request');
      } else if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
        send(404, 'Not found');
      } else {
        console.error('Static file request failed:', error);
        send(500, 'Internal server error');
      }
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  if (!process.argv[2]) throw new Error('Static directory argument is required');
  const server = await createStaticServer(process.argv[2], process.env.API_PROXY_URL, process.env.API_PROXY_PREFIX);
  server.listen(port, '0.0.0.0', () => console.log(`Static server listening on ${port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => server.close());
  }
}
