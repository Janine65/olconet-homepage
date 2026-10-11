import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

function config(environment) {
  const result = spawnSync('docker', [
    'compose', '--env-file', `infrastructure/env.${environment}.example`,
    '-f', 'compose.yaml', '-f', `compose.${environment}.yaml`,
    '--profile', 'tools', 'config', '--format', 'json',
  ], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

for (const environment of ['mac', 'synology']) {
  test(`${environment}: App-Ports sind hostlokal und Migrationen starten nur explizit`, () => {
    const { services } = config(environment);
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
    assert.equal(services.backend.volumes[0].source, 'uploads');
    assert.equal(services.backend.volumes[0].target, '/data/uploads');
    assert.equal(services.backend.volumes[0].read_only, undefined);
    assert.deepEqual(services['create-admin'].profiles, ['tools']);
    assert.equal(services['create-admin'].environment.DATABASE_URL, services.backend.environment.DATABASE_URL);
  });
}

test('Mac verwendet Host-PostgreSQL und startet keinen DB-Container', () => {
  const { services } = config('mac');
  assert.equal(services.postgres, undefined);
  assert.match(services.backend.environment.DATABASE_URL, /@host\.docker\.internal:5432\/olconet/);
});

test('Synology verwendet internes PostgreSQL mit persistentem Volume und wartet darauf', () => {
  const { services, volumes } = config('synology');
  assert.equal(services.postgres.ports, undefined);
  assert.equal(services.postgres.platform, 'linux/amd64');
  assert.equal(services.postgres.volumes[0].target, '/var/lib/postgresql');
  assert.ok(volumes['postgres-data']);
  assert.match(services.backend.environment.DATABASE_URL, /@postgres:5432\/olconet/);
  for (const name of ['backend', 'migrate', 'create-admin']) {
    assert.equal(services[name].depends_on.postgres.condition, 'service_healthy');
  }
});
