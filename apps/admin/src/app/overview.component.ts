import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService, Overview } from './auth.service';

@Component({
  standalone: true, imports: [RouterLink],
  template: `
    <h1 tabindex="-1">Uebersicht</h1>
    <p>Willkommen, {{ auth.user()?.displayName }}. Waehle einen Bereich, um Inhalte zu verwalten.</p>
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    @if (loading()) { <p role="status">Uebersicht wird geladen ...</p> }
    @if (overview(); as counts) {
      <div class="cards">
        <section><h2>Reiseberichte</h2><p class="count">{{ counts.reports }}</p>
          <p>Berichte einschliesslich Entwuerfen.</p><a routerLink="/reiseberichte">Berichte verwalten</a></section>
        <section><h2>Meine Kreationen</h2><p class="count">{{ counts.drawings }}</p>
          <p>Zeichnungen, Toepferarbeiten und Naehprojekte, einschliesslich Entwuerfen.</p><a routerLink="/kreationen">Kreationen verwalten</a></section>
        <section><h2>Sammy</h2><p class="count">{{ counts.sammyPhotos }}</p>
          <p>Fotos einschliesslich Entwuerfen.</p><a routerLink="/sammy">Sammy-Fotos verwalten</a></section>
      </div>
    }
    <section class="reports"><h2>Schnellzugriffe</h2><div class="actions">
      <a routerLink="/reiseberichte/neu">Neuen Reisebericht schreiben</a>
      <a routerLink="/bildbibliothek/upload">Mehrere Bilder hochladen</a>
      <a routerLink="/bildbibliothek">Bildbibliothek und Reisebilder</a>
    </div></section>
    <button type="button" class="secondary" (click)="load()" [disabled]="loading()">Uebersicht neu laden</button>
  `,
})
export class OverviewComponent implements OnInit {
  readonly auth = inject(AuthService);
  readonly overview = signal<Overview | null>(null);
  readonly error = signal('');
  readonly loading = signal(false);
  ngOnInit() { void this.load(); }
  async load() {
    this.loading.set(true); this.error.set('');
    try { this.overview.set(await this.auth.request<Overview>('/api/admin/overview')); }
    catch (error) { this.error.set(error instanceof Error ? error.message : 'Uebersicht konnte nicht geladen werden.'); }
    finally { this.loading.set(false); }
  }
}

@Component({
  standalone: true, imports: [RouterLink],
  template: `<h1 tabindex="-1">Seite nicht gefunden</h1>
    <p>Dieser Verwaltungsbereich existiert nicht.</p><a routerLink="/uebersicht">Zur Uebersicht</a>`,
})
export class NotFoundComponent {}
