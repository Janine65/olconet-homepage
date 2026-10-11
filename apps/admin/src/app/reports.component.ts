import { Component, EventEmitter, HostListener, OnInit, Output, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from './auth.service';
import { RichEditorComponent } from './rich-editor.component';
import { UploadedAsset, UploadQueueComponent } from './upload-queue.component';

interface ReportSummary {
  id: string; title: string; slug: string; excerpt: string; destination: string | null;
  travelStart: string | null; travelEnd: string | null; status: 'DRAFT' | 'PUBLISHED';
  version: number; publishedAt: string | null;
}
interface Report extends ReportSummary { contentHtml: string; contentMarkdown: string;
  images: { assetId: string; inGallery: boolean; caption: string | null; asset: UploadedAsset }[]; }
interface ReportList { items: ReportSummary[]; total: number; page: number; pageSize: number; }
interface ReportForm {
  title: string; slug: string; excerpt: string; contentHtml: string; destination: string;
  travelStart: string; travelEnd: string;
  galleryImages: { assetId: string; caption: string }[];
}
const emptyForm = (): ReportForm => ({
  title: '', slug: '', excerpt: '', contentHtml: '', destination: '', travelStart: '', travelEnd: '', galleryImages: [],
});

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [FormsModule, RichEditorComponent, UploadQueueComponent, RouterLink],
  templateUrl: './reports.component.html',
})
export class ReportsComponent implements OnInit {
  @ViewChild('richEditor') editor?: RichEditorComponent;
  @ViewChild(UploadQueueComponent) queue?: UploadQueueComponent;
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly savedOnEntry = this.router.currentNavigation()?.extras.state?.['saved'] === true;
  readonly mode = this.route.snapshot.data['mode'] as 'new' | 'edit' | undefined;
  @Output() changed = new EventEmitter<void>();
  readonly list = signal<ReportList | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly editing = signal(false);
  readonly current = signal<Report | null>(null);
  readonly dirty = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  form = emptyForm();
  readonly availableImages = signal<UploadedAsset[]>([]);
  readonly imageTotal = signal(0);
  readonly imageLoading = signal(false);
  readonly recentImages = signal<UploadedAsset[]>([]);
  imagePage = 1;
  selectedImageId = '';
  imageCaption = '';
  page = 1;
  private slugEdited = false;

  async ngOnInit() {
    if (this.mode === 'new') this.create();
    else if (this.mode === 'edit') {
      await this.open(this.route.snapshot.paramMap.get('id')!);
      if (this.current() && this.savedOnEntry) this.message.set('Entwurf gespeichert.');
    }
    else await this.load();
  }

  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: BeforeUnloadEvent) {
    if (this.dirty() || this.busy()) { event.preventDefault(); event.returnValue = ''; }
  }

  canLeave() {
    if (this.queue && !this.queue.canLeave()) return false;
    if (this.busy()) { this.error.set('Bitte die laufende Berichts-Anfrage abwarten.'); return false; }
    return !this.dirty() || window.confirm('Ungespeicherte Aenderungen verwerfen?');
  }

  touch() { this.dirty.set(true); this.message.set(''); }

  titleChanged() {
    if (!this.current() && !this.slugEdited) {
      this.form.slug = this.form.title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120);
    }
    this.touch();
  }

  slugChanged() { this.slugEdited = true; this.touch(); }

  async load(page = this.page) {
    this.loading.set(true);
    try {
      this.list.set(await this.auth.request<ReportList>(`/api/admin/reports?page=${page}`));
      this.page = page;
    } catch (error) { this.showError(error); }
    finally { this.loading.set(false); }
  }

  create() {
    if (!this.canLeave()) return;
    this.queue?.clear();
    this.form = emptyForm();
    this.slugEdited = false;
    this.current.set(null);
    this.recentImages.set([]);
    this.selectedImageId = ''; this.imageCaption = '';
    this.editing.set(true);
    this.dirty.set(false);
    this.error.set('');
    this.message.set('');
    void this.loadImages(1);
  }

  async open(id: string) {
    if (!this.canLeave()) return;
    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    try {
      const report = await this.auth.request<Report>(`/api/admin/reports/${id}`);
      this.queue?.clear();
      this.recentImages.set([]);
      this.selectedImageId = ''; this.imageCaption = '';
      this.accept(report);
      await this.loadImages(1);
    } catch (error) { this.showError(error); }
    finally { this.busy.set(false); }
  }

  close() {
    void this.router.navigateByUrl('/reiseberichte');
  }

  async save() {
    if (this.busy() || this.queue?.running()) return;
    const current = this.current();
    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    try {
      const report = await this.auth.request<Report>(
        current ? `/api/admin/reports/${current.id}/save` : '/api/admin/reports',
        { ...this.form, ...(current ? { version: current.version } : {}) },
      );
      this.accept(report);
      this.message.set(report.status === 'PUBLISHED' ? 'Gespeichert. Die Aenderungen sind jetzt oeffentlich.' : 'Entwurf gespeichert.');
      this.changed.emit();
    } catch (error) { this.showError(error); }
    finally { this.busy.set(false); }
    const saved = this.current();
    if (!current && saved && !this.queue?.pending()) {
      await this.router.navigate(['/reiseberichte', saved.id], { replaceUrl: true, state: { saved: true } });
    }
  }

  async changeStatus(publish: boolean) {
    const current = this.current();
    if (!current || this.busy() || this.dirty() || this.queue?.running()) return;
    if (!window.confirm(publish ? 'Diesen Bericht auf der Homepage und im RSS-Feed veroeffentlichen?' :
      'Veroeffentlichung zuruecknehmen? Der Bericht verschwindet von der Homepage und aus dem RSS-Feed.')) return;
    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    try {
      this.accept(await this.auth.request<Report>(
        `/api/admin/reports/${current.id}/${publish ? 'publish' : 'unpublish'}`, { version: current.version },
      ));
      this.message.set(publish ? 'Bericht veroeffentlicht.' : 'Veroeffentlichung zurueckgenommen.');
      this.changed.emit();
    } catch (error) { this.showError(error); }
    finally { this.busy.set(false); }
  }

  async delete() {
    const current = this.current();
    if (!current || this.busy() || current.status !== 'DRAFT' || this.dirty() || this.queue?.running()) return;
    if (this.queue && !this.queue.canLeave()) return;
    if (!window.confirm(`Den Entwurf "${current.title}" unwiderruflich loeschen?`)) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.request(`/api/admin/reports/${current.id}/delete`, { version: current.version });
      this.editing.set(false);
      this.current.set(null);
      this.dirty.set(false);
      this.queue?.clear();
      this.message.set('Entwurf geloescht.');
      this.changed.emit();
    } catch (error) { this.showError(error); }
    finally { this.busy.set(false); }
    if (!this.current()) await this.router.navigateByUrl('/reiseberichte');
  }

  private accept(report: Report) {
    this.current.set(report);
    this.slugEdited = true;
    this.form = {
      title: report.title, slug: report.slug, excerpt: report.excerpt, contentHtml: report.contentHtml,
      destination: report.destination ?? '',
      travelStart: report.travelStart?.slice(0, 10) ?? '', travelEnd: report.travelEnd?.slice(0, 10) ?? '',
      galleryImages: report.images.filter(image => image.inGallery).map(image => ({ assetId: image.assetId, caption: image.caption ?? '' })),
    };
    this.editing.set(true);
    this.dirty.set(false);
  }

  async loadImages(page = this.imagePage) {
    this.imageLoading.set(true);
    try {
      const result = await this.auth.request<{ items: UploadedAsset[]; total: number }>(`/api/admin/media?category=TRAVEL&page=${page}`);
      this.availableImages.set(result.items); this.imageTotal.set(result.total); this.imagePage = page;
    } catch (error) { this.showError(error); }
    finally { this.imageLoading.set(false); }
  }
  reportImages() {
    const images = new Map((this.current()?.images ?? []).map(image => [image.asset.id, image.asset]));
    for (const image of this.availableImages()) images.set(image.id, image);
    for (const image of this.recentImages()) images.set(image.id, image);
    return [...images.values()];
  }
  uploaded(image: UploadedAsset) {
    this.recentImages.update(images => [...images.filter(item => item.id !== image.id), image]);
    this.addGallery(image);
    this.changed.emit();
  }
  private selectedImage() { return this.reportImages().find(image => image.id === this.selectedImageId); }
  insertImage() {
    const image = this.selectedImage();
    if (!image || !this.editor) { this.error.set('Bitte ein Reisebild auswaehlen und den Editor laden.'); return; }
    this.editor.insertImage(image, this.imageCaption);
  }
  addSelectedGallery() {
    const image = this.selectedImage();
    if (!image) { this.error.set('Bitte ein Reisebild auswaehlen.'); return; }
    this.addGallery(image, this.imageCaption);
  }
  private addGallery(image: UploadedAsset, caption = '') {
    if (this.form.galleryImages.some(item => item.assetId === image.id)) return;
    this.form.galleryImages.push({ assetId: image.id, caption }); this.touch();
  }
  imageName(id: string) { return this.reportImages().find(image => image.id === id)?.title ?? id; }
  moveImage(index: number, direction: number) {
    const target = index + direction;
    if (target < 0 || target >= this.form.galleryImages.length) return;
    const images = this.form.galleryImages;
    [images[index], images[target]] = [images[target]!, images[index]!]; this.touch();
  }
  removeGallery(index: number) { this.form.galleryImages.splice(index, 1); this.touch(); }

  private showError(error: unknown) {
    this.error.set(error instanceof Error ? error.message : 'Reisebericht-Anfrage fehlgeschlagen.');
  }
}
