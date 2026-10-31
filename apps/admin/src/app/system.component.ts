import { Component, OnInit, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';
import { version as adminVersion } from '../../package.json';

interface SystemInfo {
  versions: { release: string; homepage: string; admin: string; backend: string };
  visitors: { total: number; enabled: boolean };
}

@Component({
  standalone: true,
  template: `
    <h1 tabindex="-1">Systeminfo</h1>
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    @if (loading()) { <p role="status">Systeminformationen werden geladen ...</p> }
    @if (info(); as data) {
      <section>
        <h2>Paketversionen</h2>
        <p>Release: <strong>{{ data.versions.release }}</strong> (Version in der Homepage-Fusszeile)</p>
        <dl>
          <dt>Homepage</dt><dd>{{ data.versions.homepage }}</dd>
          <dt>Admin</dt><dd>{{ adminVersion }}</dd>
          <dt>Backend</dt><dd>{{ data.versions.backend }}</dd>
        </dl>
        <p class="hint">Homepage und Release zeigen den Paketstand des Backend-Builds.
          Die Admin-Version stammt aus der aktuell geladenen Verwaltung.</p>
        @if (adminVersion !== data.versions.admin) {
          <p class="error" role="alert">Admin und Backend stammen aus unterschiedlichen Paketständen.
            Der Backend-Build erwartet Admin {{ data.versions.admin }}.</p>
        }
      </section>
      <section class="reports">
        <h2>Besucheranzahl</h2>
        <p class="count">{{ data.visitors.total.toLocaleString('de') }}</p>
        <p>Erfasste Browser-Sitzungen insgesamt. Seitenwechsel und Neuladen zählen nicht erneut.</p>
        <p role="status">Erfassung: <strong>{{ data.visitors.enabled ? 'Aktiviert' : 'Deaktiviert' }}</strong></p>
        @if (!data.visitors.enabled) {
          <p class="hint">Im Dev-Modus oder bei fehlender Besucherzähler-Konfiguration werden keine neuen Besuche erfasst.</p>
        }
        <p class="hint">Das Abrufen dieser Verwaltungsseite erhöht den Besucherzähler nicht.</p>
      </section>
    }
    <p><button type="button" class="secondary" (click)="load()" [disabled]="loading()">Systeminformationen neu laden</button></p>
  `,
})
export class SystemComponent implements OnInit {
  private readonly auth = inject(AuthService);
  readonly adminVersion = adminVersion;
  readonly info = signal<SystemInfo | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');

  ngOnInit() { void this.load(); }

  async load() {
    if (this.loading()) return;
    this.loading.set(true); this.error.set(''); this.info.set(null);
    try { this.info.set(await this.auth.request<SystemInfo>('/api/admin/system')); }
    catch (error) { this.error.set(error instanceof Error ? error.message : 'Systeminformationen konnten nicht geladen werden.'); }
    finally { this.loading.set(false); }
  }
}
