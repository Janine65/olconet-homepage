import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

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
