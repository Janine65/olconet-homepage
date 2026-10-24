import { Component, EventEmitter, HostListener, Input, OnDestroy, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from './auth.service';

export type MediaCategory = 'DRAWING' | 'SAMMY' | 'TRAVEL';
export interface UploadedAsset { id: string; title: string; altText: string; titleEn?: string; altTextEn?: string; }
interface ExistingPhotoGroup extends UploadedAsset {
  revision: number; category: MediaCategory; status: 'DRAFT' | 'PUBLISHED'; children: { id: string }[];
}
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
      <h3>{{ appendTo ? 'Fotos zur Fotogruppe hinzufuegen' : group ? 'Multi-Fotogruppe hochladen' : 'Mehrere Bilder hochladen' }}</h3>
      <p>Bis zu {{ capacity() }} Dateien auswaehlen. {{ appendTo ? 'Neue Fotos werden hinten an die bestehende Gruppe angehaengt.' : group ? '2 bis 100 Fotos bilden eine Gruppe mit gemeinsamer optionaler Bildunterschrift.' : 'Bei Bedarf eine Bildunterschrift je Bild ergaenzen.' }} Dann Warteschlange starten.
        Jede Datei wird einzeln geprueft (maximal 10 MiB). Erfolgreiche Uploads bleiben bei einem Fehler erhalten.</p>
      <p class="hint">Die Bildunterschrift wird unter dem Foto angezeigt und automatisch als Alternativtext fuer Screenreader verwendet. Ohne Bildunterschrift bleiben beide Angaben leer.</p>
      @if (group) {
        @if (appendTo) {
        <p class="hint">Titel, Alternativtext und Beschreibungen einschliesslich englischer Uebersetzungen werden von der gespeicherten Gruppe uebernommen.
          {{ appendTo.status === 'PUBLISHED' ? 'Die neuen Fotos werden nach dem Hinzufuegen sofort oeffentlich sichtbar.' : 'Die neuen Fotos bleiben mit der Gruppe privat.' }}</p>
        } @else {
        <label>Gemeinsame Bildunterschrift (optional) <input [(ngModel)]="groupTitle" [ngModelOptions]="{standalone:true}" maxlength="200" [disabled]="locked() || disabled"></label>
        <label>Gemeinsame Bildunterschrift (Englisch, optional) <input lang="en" [(ngModel)]="groupTitleEn" [ngModelOptions]="{standalone:true}" maxlength="200" [disabled]="locked() || disabled"></label>
        <p class="hint">Die Gruppe wird nach allen erfolgreichen Uploads gespeichert. Bei Fehlern bitte erneut versuchen.
          Noch nicht gruppierte Uploads bleiben als private Einzelentwuerfe in der Bildliste erhalten.</p>
        }
        @if (groupSaved()) { <p class="success" role="status">{{ appendTo ? 'Fotos zur Fotogruppe hinzugefuegt.' : 'Fotogruppe gespeichert. Sie kann in der Bildliste gemeinsam bearbeitet und veroeffentlicht werden.' }}</p> }
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
            <label>Bildunterschrift (optional) <input [(ngModel)]="entry.title" [ngModelOptions]="{standalone:true}" maxlength="200" [disabled]="entry.attempted || running() || disabled"></label>
            <label>Bildunterschrift (Englisch, optional) <input lang="en" [(ngModel)]="entry.titleEn" [ngModelOptions]="{standalone:true}" maxlength="200" [disabled]="entry.attempted || running() || disabled"></label>
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
            <button type="button" class="secondary" (click)="remove(entry)" [disabled]="running() || disabled || (group && entry.state === 'done' && (!appendTo || groupSaved()))">Aus Warteschlange entfernen</button>
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
  @Input() appendTo: ExistingPhotoGroup | null = null;
  @Output() uploaded = new EventEmitter<UploadedAsset>();
  @Output() finished = new EventEmitter<void>();
  @Output() groupUpdated = new EventEmitter<void>();
  private readonly auth = inject(AuthService);
  readonly entries = signal<QueueEntry[]>([]);
  readonly running = signal(false);
  readonly error = signal('');
  readonly groupSaved = signal(false);
  readonly groupingStarted = signal(false);
  groupTitle = '';
  groupTitleEn = '';
  private paused = false;
  ngOnDestroy() { this.paused = true; this.entries().forEach(entry => this.releasePreview(entry)); }
  waiting() { return this.entries().some(entry => entry.state === 'waiting'); }
  capacity() { return this.appendTo ? 100 - this.appendTo.children.length - 1 : 100; }
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
    if (this.entries().length + files.length > this.capacity()) {
      this.error.set(this.appendTo ? `Es koennen noch maximal ${this.capacity()} Fotos zur Gruppe hinzugefuegt werden.` :
        'Maximal 100 Eintraege pro Warteschlange. Bitte erledigte Eintraege entfernen.');
      return;
    }
    this.entries.update(entries => [...entries, ...files.map(file => ({
      key: crypto.randomUUID(), file, name: file.name, title: '',
      previewUrl: this.category === 'TRAVEL' ? URL.createObjectURL(file) : null, previewError: false,
      titleEn: '', altTextEn: '',
      altText: '', category: this.category ?? 'DRAWING', state: 'waiting' as const, progress: 0, error: '', attempted: false,
    }))]);
  }
  remove(entry: QueueEntry) {
    if (this.running() || (this.group && entry.state === 'done' && (!this.appendTo || this.groupSaved()))) return;
    this.releasePreview(entry);
    this.entries.update(entries => entries.filter(item => item !== entry));
    if (this.appendTo && !this.entries().length) this.groupingStarted.set(false);
  }
  clearDone() {
    if (this.group && !this.groupSaved()) return;
    this.entries().filter(entry => entry.state === 'done').forEach(entry => this.releasePreview(entry));
    this.entries.update(entries => entries.filter(entry => entry.state !== 'done'));
    if (this.group) { this.groupSaved.set(false); this.groupingStarted.set(false); this.groupTitle = ''; this.groupTitleEn = ''; }
  }
  clear() {
    if (this.running()) return;
    this.entries().forEach(entry => this.releasePreview(entry));
    this.entries.set([]); this.error.set(''); this.groupSaved.set(false); this.groupingStarted.set(false); this.groupTitle = '';
    this.groupTitleEn = '';
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
      const metadata = this.appendTo ?? { title: this.groupTitle.trim(), altText: this.groupTitle.trim(),
        titleEn: this.groupTitleEn.trim(), altTextEn: this.groupTitleEn.trim(), category: this.category };
      if ((metadata.category !== 'SAMMY' && metadata.category !== 'DRAWING') || this.entries().length < (this.appendTo ? 1 : 2) ||
        metadata.title.trim().length > 200 ||
        metadata.altText.trim().length > 500 ||
        (metadata.titleEn ?? '').trim().length > 200 || (metadata.altTextEn ?? '').trim().length > 500) {
        this.error.set('Bitte Fotos und gueltige gemeinsame Angaben fuer Sammy oder Meine Kreationen angeben (neue Gruppe: mindestens 2 Fotos).');
        return;
      }
      const target = this.appendTo;
      if (target && this.entries().filter(entry => !target.children.some(photo => photo.id === entry.assetId)).length > this.capacity()) {
        this.error.set('Die Fotogruppe darf insgesamt maximal 100 Fotos enthalten. Bitte ueberzaehlige Warteschlangeneintraege entfernen.');
        return;
      }
      for (const entry of this.entries()) {
        if (entry.attempted) continue;
        entry.title = metadata.title; entry.altText = metadata.altText; entry.category = metadata.category;
        entry.titleEn = metadata.titleEn ?? ''; entry.altTextEn = metadata.altTextEn ?? '';
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
        if (!this.appendTo && !entry.attempted) {
          entry.title = entry.title.trim(); entry.altText = entry.title;
          entry.titleEn = entry.titleEn.trim(); entry.altTextEn = entry.titleEn;
        }
        if (entry.title.trim().length > 200 || entry.altText.trim().length > 500 ||
          entry.titleEn.trim().length > 200 || entry.altTextEn.trim().length > 500) {
          entry.state = 'failed'; entry.error = 'Bildunterschriften duerfen maximal 200 Zeichen enthalten; Alternativtexte maximal 500.';
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
          await this.auth.request(this.appendTo ? `/api/admin/media/${this.appendTo.id}/photos` : '/api/admin/media/group', {
            ids: this.entries().map(entry => entry.assetId), ...(this.appendTo ? { revision: this.appendTo.revision } : {}),
          });
          this.groupSaved.set(true);
          if (this.appendTo) this.groupUpdated.emit();
        } catch (error) {
          this.error.set(error instanceof Error ? error.message : 'Die Fotogruppe konnte nicht gespeichert werden. Bitte erneut versuchen.');
        }
      }
    } finally { this.running.set(false); this.finished.emit(); }
  }
  private refresh() { this.entries.set([...this.entries()]); }
}
