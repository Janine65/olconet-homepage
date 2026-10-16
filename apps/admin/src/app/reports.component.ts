import { Component, EventEmitter, HostListener, OnInit, Output, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from './auth.service';
import { InlineImageSize, RichEditorComponent } from './rich-editor.component';
import { UploadedAsset, UploadQueueComponent } from './upload-queue.component';

interface ReportSummary {
  id: string; title: string; slug: string; excerpt: string; destination: string | null;
  travelStart: string | null; travelEnd: string | null; status: 'DRAFT' | 'PUBLISHED';
  version: number; publishedAt: string | null;
  titleEn: string; excerptEn: string; destinationEn: string;
}
interface ReportPage {
  id: string; title: string; contentHtml: string; status: 'DRAFT' | 'PUBLISHED';
  titleEn: string; contentHtmlEn: string;
  images: { assetId: string; inGallery: boolean; caption: string | null; captionEn: string; asset: UploadedAsset }[];
}
interface Report extends ReportSummary { contentHtml: string; contentMarkdown: string; pages: ReportPage[];
  images: { assetId: string; inGallery: boolean; caption: string | null; asset: UploadedAsset }[]; }
interface ReportList { items: ReportSummary[]; total: number; page: number; pageSize: number; }
interface PageForm {
  id: string; title: string; contentHtml: string;
  titleEn: string; contentHtmlEn: string;
  galleryImages: { assetId: string; caption: string; captionEn: string }[];
}
interface ReportForm {
  title: string; slug: string; excerpt: string; destination: string;
  travelStart: string; travelEnd: string;
  titleEn: string; excerptEn: string; destinationEn: string;
  pages: PageForm[];
}
const emptyPage = (): PageForm => ({ id: crypto.randomUUID(), title: '', contentHtml: '', titleEn: '', contentHtmlEn: '', galleryImages: [] });
const emptyForm = (): ReportForm => ({
  title: '', slug: '', excerpt: '', destination: '', travelStart: '', travelEnd: '', pages: [emptyPage()],
  titleEn: '', excerptEn: '', destinationEn: '',
});

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [FormsModule, RichEditorComponent, UploadQueueComponent, RouterLink],
  templateUrl: './reports.component.html',
})
export class ReportsComponent implements OnInit {
  @ViewChild('richEditor') editor?: RichEditorComponent;
  @ViewChild('englishEditor') englishEditor?: RichEditorComponent;
  @ViewChild(UploadQueueComponent) queue?: UploadQueueComponent;
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly savedOnEntry = this.router.currentNavigation()?.extras.state?.['saved'] === true;
  private readonly pageOnEntry: unknown = this.router.currentNavigation()?.extras.state?.['pageId'];
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
  pageIndex = 0;
  get activePage() { return this.form.pages[this.pageIndex]!; }
  readonly availableImages = signal<UploadedAsset[]>([]);
  readonly imageTotal = signal(0);
  readonly imageLoading = signal(false);
  readonly recentImages = signal<UploadedAsset[]>([]);
  imagePage = 1;
  selectedImageId = '';
  imageCaption = '';
  imageCaptionEn = '';
  imageSize: InlineImageSize = 250;
  page = 1;
  private slugEdited = false;

  async ngOnInit() {
    if (this.mode === 'new') this.create();
    else if (this.mode === 'edit') {
      await this.open(this.route.snapshot.paramMap.get('id')!);
      if (typeof this.pageOnEntry === 'string') {
        const index = this.form.pages.findIndex(page => page.id === this.pageOnEntry);
        if (index >= 0) this.pageIndex = index;
      }
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
    this.pageIndex = 0;
    this.slugEdited = false;
    this.current.set(null);
    this.recentImages.set([]);
    this.selectedImageId = ''; this.imageCaption = ''; this.imageCaptionEn = '';
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
      this.selectedImageId = ''; this.imageCaption = ''; this.imageCaptionEn = '';
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
      await this.router.navigate(['/reiseberichte', saved.id], { replaceUrl: true, state: { saved: true, pageId: this.activePage.id } });
    }
  }

  async changeStatus(publish: boolean) {
    const current = this.current();
    if (!current || this.busy() || this.dirty() || this.queue?.running()) return;
    if (!window.confirm(publish ? 'Diesen Bericht auf der Homepage und im RSS-Feed veroeffentlichen?' :
      'Alle Seiten zuruecknehmen? Der ganze Bericht verschwindet von der Homepage und aus dem RSS-Feed.')) return;
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

  currentPage(id = this.activePage.id) { return this.current()?.pages.find(page => page.id === id); }

  async changePageStatus(publish: boolean) {
    const report = this.current();
    const page = this.currentPage();
    if (!report || !page || this.busy() || this.dirty() || this.queue?.running()) return;
    const name = page.title || `Seite ${this.pageIndex + 1}`;
    if (!confirm(publish ? `"${name}" veroeffentlichen? Die erste veroeffentlichte Seite macht den Bericht auf der Homepage sichtbar.` :
      `"${name}" zuruecknehmen? Ohne weitere veroeffentlichte Seiten verschwindet auch der Bericht von der Homepage.`)) return;
    this.busy.set(true); this.error.set(''); this.message.set('');
    try {
      this.accept(await this.auth.request<Report>(
        `/api/admin/reports/${report.id}/pages/${page.id}/${publish ? 'publish' : 'unpublish'}`, { version: report.version },
      ));
      this.message.set(publish ? 'Seite veroeffentlicht.' : 'Seite zurueckgenommen.');
      this.changed.emit();
    } catch (error) { this.showError(error); }
    finally { this.busy.set(false); }
  }

  private canChangePage() {
    if (this.busy() || this.queue?.running()) {
      this.error.set('Bitte die laufende Anfrage oder den aktuellen Upload abwarten.');
      return false;
    }
    if (this.queue && !this.queue.canLeave()) return false;
    this.queue?.clear();
    this.selectedImageId = ''; this.imageCaption = ''; this.imageCaptionEn = '';
    return true;
  }
  selectPage(index: number) {
    if (index === this.pageIndex || !this.canChangePage()) return;
    this.pageIndex = index;
  }
  addPage() {
    if (this.form.pages.length >= 100) { this.error.set('Maximal 100 Seiten pro Bericht.'); return; }
    if (!this.canChangePage()) return;
    this.form.pages.push(emptyPage());
    this.pageIndex = this.form.pages.length - 1;
    this.touch();
  }
  movePage(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= this.form.pages.length || this.busy() || this.queue?.running()) return;
    const activeId = this.activePage.id;
    [this.form.pages[index], this.form.pages[target]] = [this.form.pages[target]!, this.form.pages[index]!];
    this.pageIndex = this.form.pages.findIndex(page => page.id === activeId);
    this.touch();
  }
  removePage() {
    if (this.form.pages.length <= 1 || this.busy() || this.queue?.running()) return;
    if (!confirm('Diese Seite aus dem Bericht entfernen? Beim Speichern verschwindet auch eine bereits veroeffentlichte Seite. Die Bilddateien bleiben erhalten.')) return;
    if (!this.canChangePage()) return;
    this.form.pages.splice(this.pageIndex, 1);
    this.pageIndex = Math.min(this.pageIndex, this.form.pages.length - 1);
    this.touch();
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
    const activeId = this.activePage.id;
    this.current.set(report);
    this.slugEdited = true;
    this.form = {
      title: report.title, slug: report.slug, excerpt: report.excerpt,
      titleEn: report.titleEn, excerptEn: report.excerptEn, destinationEn: report.destinationEn,
      destination: report.destination ?? '',
      travelStart: report.travelStart?.slice(0, 10) ?? '', travelEnd: report.travelEnd?.slice(0, 10) ?? '',
      pages: report.pages.map(page => ({
        id: page.id, title: page.title, contentHtml: page.contentHtml, titleEn: page.titleEn, contentHtmlEn: page.contentHtmlEn,
        galleryImages: page.images.filter(image => image.inGallery).map(image => ({ assetId: image.assetId, caption: image.caption ?? '', captionEn: image.captionEn })),
      })),
    };
    this.pageIndex = Math.max(0, this.form.pages.findIndex(page => page.id === activeId));
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
  insertImage(english = false) {
    const image = this.selectedImage();
    const editor = english ? this.englishEditor : this.editor;
    if (!image || !editor) { this.error.set('Bitte ein Reisebild auswaehlen und den Editor laden.'); return; }
    editor.insertImage(image, english ? this.imageCaptionEn : this.imageCaption, this.imageSize);
  }
  addSelectedGallery() {
    const image = this.selectedImage();
    if (!image) { this.error.set('Bitte ein Reisebild auswaehlen.'); return; }
    this.addGallery(image, this.imageCaption, this.imageCaptionEn);
  }
  private addGallery(image: UploadedAsset, caption = '', captionEn = '') {
    if (this.activePage.galleryImages.some(item => item.assetId === image.id)) return;
    this.activePage.galleryImages.push({ assetId: image.id, caption, captionEn }); this.touch();
  }
  imageName(id: string) { return this.reportImages().find(image => image.id === id)?.title ?? id; }
  moveImage(index: number, direction: number) {
    const target = index + direction;
    if (target < 0 || target >= this.activePage.galleryImages.length) return;
    const images = this.activePage.galleryImages;
    [images[index], images[target]] = [images[target]!, images[index]!]; this.touch();
  }
  removeGallery(index: number) { this.activePage.galleryImages.splice(index, 1); this.touch(); }

  private showError(error: unknown) {
    this.error.set(error instanceof Error ? error.message : 'Reisebericht-Anfrage fehlgeschlagen.');
  }
}
