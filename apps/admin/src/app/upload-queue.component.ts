import { Component, EventEmitter, HostListener, Input, OnDestroy, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from './auth.service';

export type MediaCategory = 'DRAWING' | 'SAMMY' | 'TRAVEL';
export interface UploadedAsset { id: string; title: string; altText: string; }
interface QueueEntry {
  key: string; file: File | null; name: string; title: string; altText: string; category: MediaCategory;
  state: 'waiting' | 'uploading' | 'done' | 'failed'; progress: number; error: string; attempted: boolean;
}

@Component({
  selector: 'app-upload-queue', standalone: true, imports: [FormsModule],
  template: `
    <div class="upload-queue">
      <h3>Mehrere Bilder hochladen</h3>
      <p>Bis zu 100 Dateien auswaehlen. Titel und Alternativtext je Bild ergaenzen, dann Warteschlange starten.
        Jede Datei wird einzeln geprueft (maximal 10 MiB). Erfolgreiche Uploads bleiben bei einem Fehler erhalten.</p>
      <label [for]="inputId">Bilddateien</label>
      <input [id]="inputId" type="file" multiple accept="image/jpeg,image/png,image/webp" (change)="add($event)" [disabled]="running() || disabled">
      @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
      <ul class="upload-list">
        @for (entry of entries(); track entry.key) {
          <li>
            <strong>{{ entry.name }}</strong>
            <label>Titel <input [(ngModel)]="entry.title" [ngModelOptions]="{standalone:true}" maxlength="200" [disabled]="entry.attempted || running() || disabled"></label>
            <label>Alternativtext <input [(ngModel)]="entry.altText" [ngModelOptions]="{standalone:true}" maxlength="500" [disabled]="entry.attempted || running() || disabled"></label>
            @if (!category) {
              <label>Upload-Galerie <select [(ngModel)]="entry.category" [ngModelOptions]="{standalone:true}" [disabled]="entry.attempted || running() || disabled">
                <option value="DRAWING">Meine Kreationen</option><option value="SAMMY">Sammy</option><option value="TRAVEL">Reiseberichte</option>
              </select></label>
            }
            <p role="status">{{ entry.state === 'done' ? 'Gespeichert' : entry.state === 'failed' ? 'Fehlgeschlagen' : entry.state === 'uploading' ? (entry.progress === 100 ? 'Bild wird verarbeitet ...' : 'Upload laeuft ...') : 'Wartet' }}</p>
            <progress [value]="entry.progress" max="100" [attr.aria-label]="'Upload ' + entry.name"></progress> {{ entry.progress }} %
            @if (entry.error) { <p class="error" role="alert">{{ entry.error }}</p> }
            @if (entry.state === 'failed') {
              <button type="button" (click)="retry(entry)" [disabled]="running() || disabled">Dieses Bild erneut versuchen</button>
            }
            <button type="button" class="secondary" (click)="remove(entry)" [disabled]="running() || disabled">Aus Warteschlange entfernen</button>
          </li>
        }
      </ul>
      <div class="actions">
        <button type="button" (click)="start()" [disabled]="running() || disabled || !waiting()">Warteschlange starten / fortsetzen</button>
        @if (running()) { <button type="button" (click)="pause()">Nach aktuellem Bild pausieren</button> }
        <button type="button" class="secondary" (click)="clearDone()" [disabled]="running() || disabled">Erledigte Eintraege entfernen</button>
      </div>
      <p class="hint">Nach einem begonnenen Upload bleiben Angaben fuer sichere Wiederholungen gesperrt.
        Zum Korrigieren einen fehlgeschlagenen Eintrag entfernen und die Datei erneut auswaehlen.
        Die Warteschlange bleibt nur in diesem Browser-Tab erhalten.</p>
    </div>
  `,
})
export class UploadQueueComponent implements OnDestroy {
  @Input() category: MediaCategory | null = null;
  @Input() disabled = false;
  @Input() inputId = 'upload-files';
  @Output() uploaded = new EventEmitter<UploadedAsset>();
  @Output() finished = new EventEmitter<void>();
  private readonly auth = inject(AuthService);
  readonly entries = signal<QueueEntry[]>([]);
  readonly running = signal(false);
  readonly error = signal('');
  private paused = false;
  ngOnDestroy() { this.paused = true; }
  waiting() { return this.entries().some(entry => entry.state === 'waiting'); }
  pending() { return this.entries().some(entry => entry.state !== 'done'); }
  canLeave() {
    if (this.running()) { this.error.set('Bitte den aktuellen Upload abwarten oder die Warteschlange pausieren.'); return false; }
    return !this.pending() || confirm('Nicht abgeschlossene Uploads aus der Warteschlange verwerfen?');
  }
  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: BeforeUnloadEvent) {
    if (this.pending() || this.running()) { event.preventDefault(); event.returnValue = ''; }
  }
  add(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    this.error.set('');
    if (this.entries().length + files.length > 100) { this.error.set('Maximal 100 Eintraege pro Warteschlange. Bitte erledigte Eintraege entfernen.'); return; }
    this.entries.update(entries => [...entries, ...files.map(file => ({
      key: crypto.randomUUID(), file, name: file.name, title: file.name.replace(/\.[^.]+$/, '').slice(0, 200),
      altText: '', category: this.category ?? 'DRAWING', state: 'waiting' as const, progress: 0, error: '', attempted: false,
    }))]);
  }
  remove(entry: QueueEntry) { if (!this.running()) this.entries.update(entries => entries.filter(item => item !== entry)); }
  clearDone() { this.entries.update(entries => entries.filter(entry => entry.state !== 'done')); }
  clear() { if (!this.running()) { this.entries.set([]); this.error.set(''); } }
  pause() { this.paused = true; }
  async retry(entry: QueueEntry) {
    if (this.running() || this.disabled) return;
    entry.state = 'waiting';
    await this.start(entry);
  }
  async start(only?: QueueEntry) {
    if (this.running() || this.disabled) return;
    this.running.set(true); this.paused = false;
    try {
      for (const entry of this.entries()) {
        if (this.paused) break;
        if (entry.state !== 'waiting' || (only && entry !== only)) continue;
        if (!entry.file) continue;
        entry.error = '';
        if (!entry.title.trim() || !entry.altText.trim() || entry.title.trim().length > 200 || entry.altText.trim().length > 500) {
          entry.state = 'failed'; entry.error = 'Titel (1-200 Zeichen) und Alternativtext (1-500 Zeichen) ergaenzen.';
          this.refresh(); continue;
        }
        if (!entry.file.size || entry.file.size > 10 * 1024 * 1024) {
          entry.state = 'failed'; entry.error = 'Bild muss zwischen 1 Byte und 10 MiB gross sein.'; this.refresh(); continue;
        }
        entry.state = 'uploading'; entry.progress = 0; entry.attempted = true; this.refresh();
        const body = new FormData();
        body.append('file', entry.file);
        body.append('metadata', JSON.stringify({
          title: entry.title, altText: entry.altText, category: entry.category, description: '', sortOrder: 0, uploadKey: entry.key,
        }));
        try {
          const asset = await this.auth.upload(body, percent => { entry.progress = percent; this.refresh(); });
          entry.state = 'done'; entry.progress = 100; entry.file = null;
          this.uploaded.emit({ id: asset.id, title: entry.title, altText: entry.altText });
        } catch (error) {
          entry.state = 'failed'; entry.error = error instanceof Error ? error.message : 'Upload fehlgeschlagen.';
        }
        this.refresh();
      }
    } finally { this.running.set(false); this.finished.emit(); }
  }
  private refresh() { this.entries.set([...this.entries()]); }
}
