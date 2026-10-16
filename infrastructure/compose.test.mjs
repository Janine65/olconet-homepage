import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('Package-Scripts bauen und starten Mac-Images bzw. bauen und pushen Synology-Images in der richtigen Reihenfolge', t => {
  const directory = mkdtempSync(join(tmpdir(), 'olconet-docker-scripts-'));
  t.after(() => rmSync(directory, { recursive: true }));
  const log = join(directory, 'commands.jsonl');
  writeFileSync(join(directory, 'docker'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.DOCKER_SCRIPT_TEST_LOG, JSON.stringify(args) + '\\n');
if (args.includes(process.env.DOCKER_SCRIPT_TEST_FAIL)) process.exit(9);
`, { mode: 0o700 });
  const run = (name, fail = '') => {
    writeFileSync(log, '');
    const result = spawnSync('pnpm', ['run', name], { encoding: 'utf8', env: {
      ...process.env, PATH: directory + ':' + process.env.PATH,
      DOCKER_SCRIPT_TEST_LOG: log, DOCKER_SCRIPT_TEST_FAIL: fail,
    } });
    const commands = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    return { result, commands };
  };
  const mac = ['compose', '--env-file', '.env.docker.mac', '-f', 'compose.yaml', '-f', 'compose.mac.yaml'];
  const synology = ['compose', '--env-file', '.env.docker.synology', '-f', 'compose.yaml'];
  const services = ['homepage', 'admin', 'backend'];
  for (const [name, expected] of [
    ['docker:build:mac', [[...mac, 'build', ...services]]],
    ['docker:run:mac', [[...mac, 'run', '--rm', '--no-deps', 'migrate'], [...mac, 'up', '-d', '--wait', '--no-build', ...services]]],
    ['docker:build:synology', [[...synology, 'build', ...services]]],
    ['docker:push:synology', [[...synology, 'push', ...services]]],
    ['docker:build-push:synology', [[...synology, 'build', ...services], [...synology, 'push', ...services]]],
  ]) {
    const { result, commands } = run(name);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(commands, expected, name);
  }
  for (const [name, fail] of [['docker:run:mac', 'run'], ['docker:build-push:synology', 'build']]) {
    const { result, commands } = run(name, fail);
    assert.notEqual(result.status, 0);
    assert.equal(commands.length, 1, 'Nach Fehlern duerfen weder Container gestartet noch Images gepusht werden.');
  }
});

function config(environment, standalone = false) {
  const result = spawnSync('docker', [
    'compose', '--env-file', `infrastructure/env.${environment}.example`,
    ...(standalone ? ['-f', 'infrastructure/compose.synology.standalone.yaml'] :
      ['-f', 'compose.yaml', '-f', `compose.${environment}.yaml`]),
    '--profile', 'tools', 'config', '--format', 'json',
  ], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('Mac und Synology verwenden die gewuenschten Image- und Containernamen', () => {
  for (const [environment, standalone] of [['mac', false], ['synology', false], ['synology', true]]) {
    const { services } = config(environment, standalone);
    const tag = environment === 'mac' ? 'test' : 'latest';
    for (const [service, name] of [
      ['backend', 'olconet-backend'], ['admin', 'olconet-frontend'], ['homepage', 'olconet-homepage'],
    ]) {
      assert.equal(services[service].container_name, name);
      assert.equal(services[service].image, `janine65/${name}:${tag}`);
    }
    for (const tool of ['migrate', 'create-admin']) {
      assert.equal(services[tool].image, services.backend.image);
      assert.equal(services[tool].container_name, undefined, 'CLI-Container duerfen den festen Backend-Namen nicht uebernehmen.');
    }
    assert.equal(services.admin.environment.API_PROXY_URL, 'http://backend:8080');
    assert.equal(services.homepage.environment.API_PROXY_URL, 'http://backend:8080');
  }
});

for (const environment of ['mac', 'synology']) {
  test(`${environment}: App-Ports sind hostlokal und Migrationen starten nur explizit`, () => {
    const { services, volumes } = config(environment);
    for (const [index, name] of ['homepage', 'admin', 'backend'].entries()) {
      assert.equal(services[name].ports.length, 1);
      assert.equal(services[name].ports[0].host_ip, '127.0.0.1');
      assert.equal(Number(services[name].ports[0].published), 18431 + index);
      assert.equal(services[name].ports[0].target, 8080);
      assert.equal(services[name].read_only, true);
      assert.deepEqual(services[name].cap_drop, ['ALL']);
      assert.equal(services[name].platform, environment === 'mac' ? 'linux/arm64' : 'linux/amd64');
      assert.ok(services[name].healthcheck);
    }
    assert.deepEqual(services.migrate.profiles, ['tools']);
    assert.equal(services.migrate.restart, 'no');
    assert.deepEqual(services.migrate.command.slice(-2), ['migrate', 'deploy']);
    assert.equal(services.migrate.environment.DATABASE_URL, services.backend.environment.DATABASE_URL);
    assert.equal(services.admin.environment.API_PROXY_URL, 'http://backend:8080');
    assert.equal(services.homepage.environment.API_PROXY_URL, 'http://backend:8080');
    assert.equal(services.homepage.environment.API_PROXY_PREFIX, '/api/public/');
    assert.equal(services.backend.environment.SITE_URL,
      environment === 'mac' ? 'http://localhost:18431' : 'https://olconet.com');
    assert.equal(services.backend.environment.ADMIN_ORIGIN,
      environment === 'mac' ? 'http://localhost:18432' : 'https://verwaltung.example.com');
    assert.equal(services.backend.environment.UPLOAD_DIR, '/data/uploads');
    assert.equal(services.backend.volumes.length, 1);
    assert.equal(services.backend.volumes[0].type, environment === 'mac' ? 'volume' : 'bind');
    assert.equal(services.backend.volumes[0].source,
      environment === 'mac' ? 'uploads' : '/volume1/server/olconet/uploads');
    assert.equal(services.backend.volumes[0].target, '/data/uploads');
    assert.equal(services.backend.volumes[0].read_only, undefined);
    if (environment === 'mac') assert.equal(volumes.uploads.name, 'olconet_uploads');
    else assert.equal(volumes?.uploads, undefined);
    assert.deepEqual(services['create-admin'].profiles, ['tools']);
    assert.equal(services['create-admin'].environment.DATABASE_URL, services.backend.environment.DATABASE_URL);
  });
}

test('Mac verwendet Host-PostgreSQL und startet keinen DB-Container', () => {
  const { services } = config('mac');
  assert.equal(services.postgres, undefined);
  const url = new URL(services.backend.environment.DATABASE_URL);
  assert.equal(url.hostname, 'host.docker.internal');
  assert.equal(url.port, '5436');
  assert.equal(url.pathname, '/olconet');
  assert.equal(url.searchParams.get('schema'), 'webpage');
});

test('Synology verwendet vorhandenes PostgreSQL im externen back-tier-Netzwerk', () => {
  const { services, volumes, networks } = config('synology');
  assert.equal(services.postgres, undefined);
  assert.equal(volumes?.['postgres-data'], undefined);
  assert.equal(networks['back-tier'].external, true);
  assert.equal(networks['back-tier'].name, 'back-tier');
  assert.equal(services.backend.volumes[0].bind.create_host_path, false);
  const url = new URL(services.backend.environment.DATABASE_URL);
  assert.equal(url.hostname, 'postgres_server');
  assert.equal(url.port, '5432');
  assert.equal(url.pathname, '/olconet');
  assert.equal(url.searchParams.get('schema'), 'webpage');
  for (const name of ['backend', 'migrate', 'create-admin']) {
    assert.deepEqual(Object.keys(services[name].networks).sort(), ['back-tier', 'olconet']);
    assert.equal(services[name].depends_on, undefined);
  }
  for (const name of ['homepage', 'admin']) assert.deepEqual(Object.keys(services[name].networks), ['olconet']);
});

test('Eigenstaendige Synology-Datei entspricht der kombinierten Konfiguration ohne Build-Schritte', () => {
  const combined = config('synology');
  const standalone = config('synology', true);
  for (const service of Object.values(combined.services)) delete service.build;
  assert.equal(standalone.name, combined.name);
  assert.deepEqual(standalone.networks, combined.networks);
  assert.deepEqual(standalone.services, combined.services);
  assert.equal(standalone.volumes, combined.volumes);
  for (const service of Object.values(standalone.services)) assert.equal(service.build, undefined);
});
