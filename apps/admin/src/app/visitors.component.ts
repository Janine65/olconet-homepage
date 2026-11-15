import { Component, OnInit, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from './auth.service';

interface CountRow { label: string; count: number; }
interface VisitorReport {
  from: string;
  to: string;
  enabled: boolean;
  geoIpEnabled: boolean;
  totalSessions: number;
  totalPageViews: number;
  averageDurationSeconds: number | null;
  durationSamples: number;
  sessionsByDay: CountRow[];
  sessionsByCountry: CountRow[];
  sessionsBySource: CountRow[];
  sessionsByWeekday: CountRow[];
  sessionsByHour: CountRow[];
  sessionsByDevice: CountRow[];
  sessionsByBrowser: CountRow[];
  pageViewsByPage: CountRow[];
  sessionsByDuration: CountRow[];
}

@Component({
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet],
  template: `
    <h1 tabindex="-1">Besucherstatistik</h1>
    <p>Browser-Sitzungen und Seitenaufrufe der letzten 365 Tage. IP-Adressen werden nicht gespeichert.</p>
    <form class="report-form" (ngSubmit)="load()">
      <div class="date-fields">
        <label>Von <input type="date" name="from" required [(ngModel)]="from" [disabled]="loading()"></label>
        <label>Bis <input type="date" name="to" required [(ngModel)]="to" [disabled]="loading()"></label>
      </div>
      <button type="submit" [disabled]="loading()">{{ loading() ? 'Wird geladen …' : 'Auswerten' }}</button>
    </form>
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    @if (loading()) { <p role="status">Besuchsdaten werden geladen …</p> }
    @if (report(); as data) {
      <p role="status">
        Erfassung: <strong>{{ data.enabled ? 'Aktiviert' : 'Deaktiviert' }}</strong>;
        GeoIP: <strong>{{ data.geoIpEnabled ? 'Aktiviert' : 'Keine Datenbank konfiguriert' }}</strong>
      </p>
      <div class="cards">
        <section><h2>Sitzungen</h2><p class="count">{{ data.totalSessions.toLocaleString('de') }}</p></section>
        <section><h2>Seitenaufrufe</h2><p class="count">{{ data.totalPageViews.toLocaleString('de') }}</p></section>
        <section><h2>Ø Besuchsdauer</h2>
          <p class="count">{{ formatDuration(data.averageDurationSeconds) }}</p>
          <p>{{ data.durationSamples.toLocaleString('de') }} Sitzungen mit erfasster Dauer</p>
        </section>
      </div>
      <div class="analytics-grid">
        <section><h2>Besuche nach Tag</h2><ng-container *ngTemplateOutlet="list; context: { $implicit: data.sessionsByDay }"></ng-container></section>
        <section><h2>Besuche nach Land</h2><ng-container *ngTemplateOutlet="list; context: { $implicit: data.sessionsByCountry }"></ng-container></section>
        <section><h2>Zugriffsquelle</h2><ng-container *ngTemplateOutlet="list; context: { $implicit: data.sessionsBySource }"></ng-container></section>
        <section><h2>Wochentag</h2><ng-container *ngTemplateOutlet="list; context: { $implicit: data.sessionsByWeekday }"></ng-container></section>
        <section><h2>Uhrzeit (UTC)</h2><ng-container *ngTemplateOutlet="list; context: { $implicit: data.sessionsByHour }"></ng-container></section>
        <section><h2>Besuchsdauer</h2><ng-container *ngTemplateOutlet="list; context: { $implicit: data.sessionsByDuration }"></ng-container></section>
        <section><h2>Seiten</h2><ng-container *ngTemplateOutlet="list; context: { $implicit: data.pageViewsByPage }"></ng-container></section>
        <section><h2>Geräte</h2><ng-container *ngTemplateOutlet="list; context: { $implicit: data.sessionsByDevice }"></ng-container></section>
        <section><h2>Browser</h2><ng-container *ngTemplateOutlet="list; context: { $implicit: data.sessionsByBrowser }"></ng-container></section>
      </div>
      <ng-template #list let-rows>
        @if (rows.length) {
          <ol class="analytics-list">
            @for (row of rows; track row.label) {
              <li><span>{{ displayLabel(row.label) }}</span><strong>{{ row.count.toLocaleString('de') }}</strong></li>
            }
          </ol>
        } @else {
          <p class="hint">Keine Daten für diesen Zeitraum.</p>
        }
      </ng-template>
    }
  `,
  styles: [`
    .analytics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 1rem; margin-top: 1.5rem; }
    .analytics-grid section { min-width: 0; }
    .analytics-list { list-style: none; padding: 0; margin: 0; }
    .analytics-list li { display: flex; justify-content: space-between; gap: .75rem; padding: .5rem 0; border-top: 1px solid #d4ddd4; }
    .analytics-list li span { overflow-wrap: anywhere; }
  `],
})
export class VisitorsComponent implements OnInit {
  private readonly auth = inject(AuthService);
  readonly report = signal<VisitorReport | null>(null);
  readonly error = signal('');
  readonly loading = signal(false);
  from = dateOffset(-29);
  to = dateOffset(0);

  ngOnInit() { void this.load(); }

  async load() {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set('');
    this.report.set(null);
    try {
      const query = new URLSearchParams({ from: this.from, to: this.to });
      this.report.set(await this.auth.request<VisitorReport>(`/api/admin/visitors?${query}`));
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Besucherstatistik konnte nicht geladen werden.');
    } finally {
      this.loading.set(false);
    }
  }

  formatDuration(seconds: number | null) {
    if (seconds === null) return '–';
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return minutes ? `${minutes} Min. ${remainder} Sek.` : `${remainder} Sek.`;
  }

  displayLabel(label: string) {
    const sourceLabels: Record<string, string> = {
      direct: 'Direkt', search: 'Suchmaschine', referral: 'Verweis', unknown: 'Unbekannt',
      mobile: 'Mobilgerät', desktop: 'Desktop', tablet: 'Tablet',
    };
    if (sourceLabels[label]) return sourceLabels[label];
    if (/^[A-Z]{2}$/.test(label)) return new Intl.DisplayNames(['de'], { type: 'region' }).of(label) ?? label;
    return label;
  }
}

function dateOffset(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
