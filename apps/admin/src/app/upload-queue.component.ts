import { Component, EventEmitter, HostListener, Input, OnDestroy, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from './auth.service';

export type MediaCategory = 'DRAWING' | 'SAMMY' | 'TRAVEL';
export interface UploadedAsset { id: string; title: string; altText: string; titleEn?: string; altTextEn?: string; }
interface QueueEntry {
  key: string; file: File | null; name: string; title: string; altText: string; category: MediaCategory;
  previewUrl: string | null; previewError: boolean;
  titleEn: string; altTextEn: string;
  state: 'waiting' | 'uploading' | 'done' | 'failed'; progress: number; error: string; attempted: boolean;
  assetId?: string;
}

@Component({
  selector: 'app-upload-queue', standalone: true, imports: [FormsModule],
  template: `
    <div class="upload-queue">
      <h3>{{ group ? 'Multi-Fotogruppe hochladen' : 'Mehrere Bilder hochladen' }}</h3>
      <p>Bis zu 100 Dateien auswaehlen. {{ group ? '2 bis 100 Fotos bilden eine Gruppe mit gemeinsamem Titel und Alternativtext.' : 'Titel und Alternativtext je Bild ergaenzen.' }} Dann Warteschlange starten.
        Jede Datei wird einzeln geprueft (maximal 10 MiB). Erfolgreiche Uploads bleiben bei einem Fehler erhalten.</p>
      @if (group) {
        <label>Gemeinsamer Titel <input [(ngModel)]="groupTitle" [ngModelOptions]="{standalone:true}" maxlength="200" [disabled]="locked() || disabled"></label>
        <label>Gemeinsamer Alternativtext <input [(ngModel)]="groupAltText" [ngModelOptions]="{standalone:true}" maxlength="500" [disabled]="locked() || disabled"></label>
        <label>Gemeinsamer Titel (Englisch, optional) <input lang="en" [(ngModel)]="groupTitleEn" [ngModelOptions]="{standalone:true}" maxlength="200" [disabled]="locked() || disabled"></label>
        <label>Gemeinsamer Alternativtext (Englisch, optional) <input lang="en" [(ngModel)]="groupAltTextEn" [ngModelOptions]="{standalone:true}" maxlength="500" [disabled]="locked() || disabled"></label>
        <p class="hint">Die Gruppe wird nach allen erfolgreichen Uploads gespeichert. Bei Fehlern bitte erneut versuchen.
          Noch nicht gruppierte Uploads bleiben als private Einzelentwuerfe in der Bildliste erhalten.</p>
        @if (groupSaved()) { <p class="success" role="status">Fotogruppe gespeichert. Sie kann in der Bildliste gemeinsam bearbeitet und veroeffentlicht werden.</p> }
      }
      <label [for]="inputId">Bilddateien</label>
      <input [id]="inputId" type="file" multiple accept="image/jpeg,image/png,image/webp" (change)="add($event)" [disabled]="running() || disabled || (group && groupingStarted())">
      @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
      <ul class="upload-list">
        @for (entry of entries(); track entry.key) {
          <li>
            <strong>{{ entry.name }}</strong>
            @if (category === 'TRAVEL') {
              @if (entry.previewUrl || entry.assetId) {
                <img class="report-image-preview" [src]="entry.assetId ? '/api/admin/media/' + entry.assetId + '/image' : entry.previewUrl"
                  [alt]="'Vorschau: ' + entry.name" (error)="entry.previewError = true">
              }
              @if (entry.previewError) { <p class="error" role="alert">Die Vorschau fuer {{ entry.name }} konnte nicht geladen werden.</p> }
            }
            @if (!group) {
            <label>Titel <input [(ngModel)]="entry.title" [ngModelOptions]="{standalone:true}" maxlength="200" [disabled]="entry.attempted || running() || disabled"></label>
            <label>Alternativtext <input [(ngModel)]="entry.altText" [ngModelOptions]="{standalone:true}" maxlength="500" [disabled]="entry.attempted || running() || disabled"></label>
            <label>Titel (Englisch, optional) <input lang="en" [(ngModel)]="entry.titleEn" [ngModelOptions]="{standalone:true}" maxlength="200" [disabled]="entry.attempted || running() || disabled"></label>
            <label>Alternativtext (Englisch, optional) <input lang="en" [(ngModel)]="entry.altTextEn" [ngModelOptions]="{standalone:true}" maxlength="500" [disabled]="entry.attempted || running() || disabled"></label>
            @if (!category) {
              <label>Upload-Galerie <select [(ngModel)]="entry.category" [ngModelOptions]="{standalone:true}" [disabled]="entry.attempted || running() || disabled">
                <option value="DRAWING">Meine Kreationen</option><option value="SAMMY">Sammy</option><option value="TRAVEL">Reiseberichte</option>
              </select></label>
            }
            }
            <p role="status">{{ entry.state === 'done' ? 'Gespeichert' : entry.state === 'failed' ? 'Fehlgeschlagen' : entry.state === 'uploading' ? (entry.progress === 100 ? 'Bild wird verarbeitet ...' : 'Upload laeuft ...') : 'Wartet' }}</p>
            <progress [value]="entry.progress" max="100" [attr.aria-label]="'Upload ' + entry.name"></progress> {{ entry.progress }} %
            @if (entry.error) { <p class="error" role="alert">{{ entry.error }}</p> }
            @if (entry.state === 'failed') {
              <button type="button" (click)="retry(entry)" [disabled]="running() || disabled">Dieses Bild erneut versuchen</button>
            }
            <button type="button" class="secondary" (click)="remove(entry)" [disabled]="running() || disabled || (group && entry.state === 'done')">Aus Warteschlange entfernen</button>
          </li>
        }
      </ul>
      <div class="actions">
        <button type="button" (click)="start()" [disabled]="running() || disabled || (!waiting() && !(group && entries().length && !groupSaved()))">Warteschlange starten / fortsetzen</button>
        @if (running()) { <button type="button" (click)="pause()">Nach aktuellem Bild pausieren</button> }
        <button type="button" class="secondary" (click)="clearDone()" [disabled]="running() || disabled || (group && !groupSaved())">Erledigte Eintraege entfernen</button>
      </div>
      <p class="hint">Nach einem begonnenen Upload bleiben Angaben fuer sichere Wiederholungen gesperrt.
        Zum Korrigieren einen fehlgeschlagenen Eintrag entfernen und die Datei erneut auswaehlen.
        Die Warteschlange bleibt nur in diesem Browser-Tab erhalten.</p>
    </div>
  `,
})
export class UploadQueueComponent implements OnDestroy {
  @Input() category: MediaCategory | null = null;
  @Input() group = false;
  @Input() disabled = false;
  @Input() inputId = 'upload-files';
  @Output() uploaded = new EventEmitter<UploadedAsset>();
  @Output() finished = new EventEmitter<void>();
  private readonly auth = inject(AuthService);
  readonly entries = signal<QueueEntry[]>([]);
  readonly running = signal(false);
  readonly error = signal('');
  readonly groupSaved = signal(false);
  readonly groupingStarted = signal(false);
  groupTitle = '';
  groupAltText = '';
  groupTitleEn = '';
  groupAltTextEn = '';
  private paused = false;
  ngOnDestroy() { this.paused = true; this.entries().forEach(entry => this.releasePreview(entry)); }
  waiting() { return this.entries().some(entry => entry.state === 'waiting'); }
  locked() { return this.running() || this.entries().some(entry => entry.attempted); }
  pending() { return this.entries().some(entry => entry.state !== 'done') || (this.group && !!this.entries().length && !this.groupSaved()); }
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
    if (this.group && this.groupingStarted()) return;
    if (this.entries().length + files.length > 100) { this.error.set('Maximal 100 Eintraege pro Warteschlange. Bitte erledigte Eintraege entfernen.'); return; }
    this.entries.update(entries => [...entries, ...files.map(file => ({
      key: crypto.randomUUID(), file, name: file.name, title: this.category === 'TRAVEL' ? '' : file.name.replace(/\.[^.]+$/, '').slice(0, 200),
      previewUrl: this.category === 'TRAVEL' ? URL.createObjectURL(file) : null, previewError: false,
      titleEn: '', altTextEn: '',
      altText: '', category: this.category ?? 'DRAWING', state: 'waiting' as const, progress: 0, error: '', attempted: false,
    }))]);
  }
  remove(entry: QueueEntry) {
    if (this.running() || (this.group && entry.state === 'done')) return;
    this.releasePreview(entry);
    this.entries.update(entries => entries.filter(item => item !== entry));
  }
  clearDone() {
    if (this.group && !this.groupSaved()) return;
    this.entries().filter(entry => entry.state === 'done').forEach(entry => this.releasePreview(entry));
    this.entries.update(entries => entries.filter(entry => entry.state !== 'done'));
    if (this.group) { this.groupSaved.set(false); this.groupingStarted.set(false); this.groupTitle = ''; this.groupAltText = ''; this.groupTitleEn = ''; this.groupAltTextEn = ''; }
  }
  clear() {
    if (this.running()) return;
    this.entries().forEach(entry => this.releasePreview(entry));
    this.entries.set([]); this.error.set(''); this.groupSaved.set(false); this.groupingStarted.set(false); this.groupTitle = ''; this.groupAltText = '';
    this.groupTitleEn = ''; this.groupAltTextEn = '';
  }
  private releasePreview(entry: QueueEntry) {
    if (!entry.previewUrl) return;
    URL.revokeObjectURL(entry.previewUrl);
    entry.previewUrl = null;
  }
  pause() { this.paused = true; }
  async retry(entry: QueueEntry) {
    if (this.running() || this.disabled) return;
    entry.state = 'waiting';
    await this.start(entry);
  }
  async start(only?: QueueEntry) {
    if (this.running() || this.disabled) return;
    if (this.group) {
      if (this.groupSaved()) return;
      if ((this.category !== 'SAMMY' && this.category !== 'DRAWING') || this.entries().length < 2 ||
        !this.groupTitle.trim() || this.groupTitle.trim().length > 200 ||
        !this.groupAltText.trim() || this.groupAltText.trim().length > 500 ||
        this.groupTitleEn.trim().length > 200 || this.groupAltTextEn.trim().length > 500) {
        this.error.set('Bitte 2 bis 100 Fotos, einen gemeinsamen Titel (1-200 Zeichen) und Alternativtext (1-500 Zeichen) fuer Sammy oder Meine Kreationen angeben.');
        return;
      }
      for (const entry of this.entries()) {
        entry.title = this.groupTitle; entry.altText = this.groupAltText; entry.category = this.category;
        entry.titleEn = this.groupTitleEn; entry.altTextEn = this.groupAltTextEn;
      }
    }
    this.error.set('');
    this.running.set(true); this.paused = false;
    try {
      for (const entry of this.entries()) {
        if (this.paused) break;
        if (entry.state !== 'waiting' || (only && entry !== only)) continue;
        if (!entry.file) continue;
        entry.error = '';
        if (!entry.title.trim() || !entry.altText.trim() || entry.title.trim().length > 200 || entry.altText.trim().length > 500 ||
          entry.titleEn.trim().length > 200 || entry.altTextEn.trim().length > 500) {
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
          titleEn: entry.titleEn, altTextEn: entry.altTextEn,
        }));
        try {
          const asset = await this.auth.upload(body, percent => { entry.progress = percent; this.refresh(); });
          entry.state = 'done'; entry.progress = 100; entry.file = null;
          entry.assetId = asset.id;
          this.releasePreview(entry);
          entry.previewError = false;
          this.uploaded.emit({ id: asset.id, title: entry.title, altText: entry.altText, titleEn: entry.titleEn, altTextEn: entry.altTextEn });
        } catch (error) {
          entry.state = 'failed'; entry.error = error instanceof Error ? error.message : 'Upload fehlgeschlagen.';
        }
        this.refresh();
      }
      if (this.group && this.entries().every(entry => entry.state === 'done')) {
        this.groupingStarted.set(true);
        try {
          await this.auth.request('/api/admin/media/group', { ids: this.entries().map(entry => entry.assetId) });
          this.groupSaved.set(true);
        } catch (error) {
          this.error.set(error instanceof Error ? error.message : 'Die Fotogruppe konnte nicht gespeichert werden. Bitte erneut versuchen.');
        }
      }
    } finally { this.running.set(false); this.finished.emit(); }
  }
  private refresh() { this.entries.set([...this.entries()]); }
}
