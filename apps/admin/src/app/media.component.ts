import { Component, EventEmitter, HostListener, OnInit, Output, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from './auth.service';
import { MediaCategory, UploadQueueComponent } from './upload-queue.component';
import { MediaOrderComponent } from './media-order.component';

interface Asset {
  id: string; revision: number; title: string; altText: string; description: string | null;
  category: MediaCategory; status: 'DRAFT' | 'PUBLISHED'; sortOrder: number;
}
interface MediaList { items: Asset[]; total: number; page: number; pageSize: number; }

@Component({
  selector: 'app-media', standalone: true, imports: [FormsModule, UploadQueueComponent, MediaOrderComponent, RouterLink], templateUrl: './media.component.html',
})
export class MediaComponent implements OnInit {
  @ViewChild(UploadQueueComponent) queue?: UploadQueueComponent;
  @Output() readonly changed = new EventEmitter<void>();
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly mode = this.route.snapshot.data['mode'] as 'list' | 'new' | 'edit' | 'sort' | 'upload';
  readonly gallery = this.route.snapshot.data['category'] as 'DRAWING' | 'SAMMY' | null;
  readonly basePath = '/' + this.route.snapshot.data['basePath'];
  readonly label = this.route.snapshot.data['label'] as string;
  readonly busy = signal(false);
  readonly error = signal('');
  readonly success = signal('');
  readonly list = signal<MediaList>({ items: [], total: 0, page: 1, pageSize: 20 });
  readonly sortingCategory = signal<'DRAWING' | 'SAMMY' | null>(null);
  filter = '';
  page = 1;
  selected: Asset | null = null;
  file: File | null = null;
  title = '';
  altText = '';
  description = '';
  category: MediaCategory = 'DRAWING';
  sortOrder = 0;
  private initial = '';

  ngOnInit() {
    this.filter = this.gallery ?? '';
    this.category = this.gallery ?? 'DRAWING';
    this.initial = this.snapshot();
    if (this.mode === 'sort') this.sortingCategory.set(this.gallery);
    else if (this.mode === 'edit') {
      void this.run(async () => {
        const asset = await this.auth.request<Asset>(`/api/admin/media/${this.route.snapshot.paramMap.get('id')!}`);
        this.accept(asset);
      });
    } else if (this.mode === 'list') void this.run(() => this.load());
  }
  private snapshot() { return JSON.stringify([this.title, this.altText, this.description, this.category, this.sortOrder]); }
  dirty() { return !!this.file || this.snapshot() !== this.initial; }
  canLeave(includeQueue = true) {
    if (this.queue?.running()) { this.error.set('Bitte den aktuellen Upload abwarten.'); return false; }
    if (includeQueue && this.queue && !this.queue.canLeave()) return false;
    if (this.busy()) { this.error.set('Bitte die laufende Bildanfrage abwarten.'); return false; }
    return !this.dirty() || confirm('Nicht gespeicherte Bildangaben verwerfen?');
  }
  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: BeforeUnloadEvent) {
    if (this.dirty() || this.busy()) { event.preventDefault(); event.returnValue = ''; }
  }

  async load(): Promise<void> {
    const result = await this.auth.request<MediaList>(`/api/admin/media?page=${this.page}${this.filter ? `&category=${this.filter}` : ''}`);
    if (!result.items.length && this.page > 1) { this.page--; return this.load(); }
    this.list.set(result);
  }
  uploaded() { this.changed.emit(); }
  openSorting(category: 'DRAWING' | 'SAMMY') {
    void this.router.navigateByUrl(category === 'SAMMY' ? '/sammy/sortieren' : '/kreationen/sortieren');
  }
  closeSorting() { void this.router.navigateByUrl(this.basePath); }
  sorted() { this.changed.emit(); }
  async reload(page = 1) {
    if (!this.canLeave(false)) return;
    this.reset();
    this.page = page;
    await this.run(() => this.load());
  }
  pickFile(event: Event) {
    const input = event.target as HTMLInputElement;
    this.file = input.files?.[0] ?? null;
    input.value = '';
    if (this.file && this.file.size > 10 * 1024 * 1024) {
      this.file = null;
      this.error.set('Das Bild ist groesser als 10 MiB.');
    }
  }
  edit(asset: Asset) {
    void this.router.navigate([this.basePath, 'bild', asset.id]);
  }
  private accept(asset: Asset) {
    this.selected = asset;
    this.file = null;
    this.title = asset.title;
    this.altText = asset.altText;
    this.description = asset.description ?? '';
    this.category = asset.category;
    this.sortOrder = asset.sortOrder;
    this.initial = this.snapshot();
    this.error.set('');
    this.success.set('');
  }
  newImage() { void this.router.navigateByUrl(this.basePath + '/neu'); }
  private reset() {
    this.selected = null;
    this.file = null;
    this.title = ''; this.altText = ''; this.description = ''; this.category = this.gallery ?? 'DRAWING'; this.sortOrder = 0;
    this.initial = this.snapshot();
  }
  async save() {
    if (this.queue?.running()) return;
    let saved = false;
    await this.run(async () => {
      const metadata = { title: this.title, altText: this.altText, description: this.description, category: this.category, sortOrder: this.sortOrder };
      if (this.selected) {
        await this.auth.request(`/api/admin/media/${this.selected.id}/save`, { ...metadata, revision: this.selected.revision });
      } else {
        if (!this.file) throw new Error('Bitte eine Bilddatei auswaehlen.');
        const body = new FormData();
        body.append('file', this.file);
        body.append('metadata', JSON.stringify(metadata));
        await this.auth.request('/api/admin/media', body);
      }
      this.reset();
      this.success.set('Bild gespeichert.');
      this.changed.emit();
      saved = true;
    });
    if (saved) await this.router.navigateByUrl(this.basePath);
  }
  async action(asset: Asset, action: 'publish' | 'unpublish' | 'delete') {
    if (!this.canLeave(false)) return;
    const prompts = {
      publish: `Bild "${asset.title}" oeffentlich veroeffentlichen?`,
      unpublish: `Bild "${asset.title}" aus der oeffentlichen Galerie entfernen?`,
      delete: `Entwurf "${asset.title}" und die Bilddatei unwiderruflich loeschen?`,
    };
    if (!confirm(prompts[action])) return;
    await this.run(async () => {
      await this.auth.request(`/api/admin/media/${asset.id}/${action}`, { revision: asset.revision });
      this.reset();
      this.success.set(action === 'publish' ? 'Bild veroeffentlicht.' : action === 'unpublish' ? 'Veroeffentlichung zurueckgenommen.' : 'Bild geloescht.');
      this.changed.emit();
      await this.load();
    });
  }
  private async run(work: () => Promise<void>) {
    if (this.busy()) return;
    this.busy.set(true); this.error.set(''); this.success.set('');
    try { await work(); }
    catch (error) { this.error.set(error instanceof Error ? error.message : 'Die Bildanfrage ist fehlgeschlagen.'); }
    finally { this.busy.set(false); }
  }
}
