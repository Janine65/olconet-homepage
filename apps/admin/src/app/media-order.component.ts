import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { FormsModule } from '@angular/forms';
import { AuthService } from './auth.service';

interface OrderItem { id: string; title: string; altText: string; status: 'DRAFT' | 'PUBLISHED'; position: number; _count: { children: number }; }
interface OrderPage { items: OrderItem[]; total: number; page: number; pageSize: number; token: string; category: string; }

@Component({
  selector: 'app-media-order', standalone: true, imports: [FormsModule, DragDropModule],
  template: `
    <section class="media-order">
      <h3>Reihenfolge: {{ category === 'SAMMY' ? 'Sammy' : 'Meine Kreationen' }}</h3>
      <p>Bilder oder ganze Fotogruppen am Griff ziehen oder mit Vor/Zurueck verschieben. Fuer Spruenge ueber Seiten hinweg
        eine Zielposition eingeben. Jede Verschiebung wird sofort gespeichert, auch fuer die Homepage.
        Entwuerfe werden mitsortiert, bleiben aber privat.</p>
      @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
      @if (message()) { <p class="success" role="status">{{ message() }}</p> }
      @if (busy()) { <p role="status">Reihenfolge wird geladen oder gespeichert ...</p> }
      <button type="button" (click)="reload(page)" [disabled]="busy() || disabled">Reihenfolge neu laden</button>
      @if (order(); as data) {
        @if (!data.total) { <p>In dieser Kategorie sind noch keine Bilder.</p> }
        <ol class="media-sort-list" cdkDropList [cdkDropListData]="data.items"
            [cdkDropListDisabled]="busy() || disabled" (cdkDropListDropped)="drop($event)" [attr.start]="(data.page - 1) * 20 + 1">
          @for (item of data.items; track item.id) {
            <li cdkDrag [cdkDragData]="item">
              <button type="button" class="drag-handle secondary" cdkDragHandle
                [disabled]="busy() || disabled" [attr.aria-label]="'Bild ' + (item.title || item.position) + ' ziehen'">Ziehen</button>
              <img [src]="'/api/admin/media/' + item.id + '/image'" [alt]="item.altText" loading="lazy"
                (error)="error.set('Eine Bildvorschau fehlt. Bitte Upload-Speicher pruefen.')">
              <div>
                <strong>{{ item.position }}. {{ item.title || 'Bild ohne Bildunterschrift' }}</strong>
                @if (item._count.children) { <p>Fotogruppe · {{ item._count.children + 1 }} Fotos</p> }
                <p>{{ item.status === 'PUBLISHED' ? 'Veroeffentlicht' : 'Entwurf' }}</p>
                <div class="sort-actions">
                  <button type="button" (click)="move(item, item.position - 1)" [disabled]="busy() || disabled || item.position <= 1"
                    [attr.aria-label]="'Bild ' + (item.title || item.position) + ' nach vorne'">Vor</button>
                  <button type="button" (click)="move(item, item.position + 1)" [disabled]="busy() || disabled || item.position >= data.total"
                    [attr.aria-label]="'Bild ' + (item.title || item.position) + ' nach hinten'">Zurueck</button>
                  <label [for]="'position-' + item.id">Zielposition</label>
                  <input [id]="'position-' + item.id" type="number" min="1" [max]="data.total"
                    [ngModel]="targets[item.id] ?? item.position" (ngModelChange)="targets[item.id] = $event"
                    [disabled]="busy() || disabled">
                  <button type="button" (click)="move(item, targets[item.id] ?? item.position)"
                    [disabled]="busy() || disabled">An Zielposition verschieben</button>
                </div>
              </div>
            </li>
          }
        </ol>
        <div class="actions">
          <button type="button" (click)="reload(page - 1)" [disabled]="busy() || disabled || page <= 1">Vorherige Sortierseite</button>
          <span>Seite {{ data.page }} · {{ data.total }} Bilder / Fotogruppen insgesamt</span>
          <button type="button" (click)="reload(page + 1)" [disabled]="busy() || disabled || page * 20 >= data.total">Naechste Sortierseite</button>
        </div>
      }
    </section>
  `,
})
export class MediaOrderComponent implements OnInit {
  @Input({ required: true }) category!: 'DRAWING' | 'SAMMY';
  @Input() disabled = false;
  @Output() saved = new EventEmitter<void>();
  @Output() busyChange = new EventEmitter<boolean>();
  private readonly auth = inject(AuthService);
  readonly busy = signal(false);
  readonly order = signal<OrderPage | null>(null);
  readonly error = signal('');
  readonly message = signal('');
  targets: Record<string, number | null> = {};
  page = 1;

  ngOnInit() { queueMicrotask(() => { void this.reload(1); }); }

  private async load(page: number): Promise<void> {
    const data = await this.auth.request<OrderPage>(`/api/admin/media/order?category=${this.category}&page=${page}`);
    if (!data.items.length && page > 1) return this.load(Math.max(1, Math.ceil(data.total / 20)));
    this.order.set(data); this.page = data.page; this.targets = {};
  }

  async reload(page: number) {
    if (this.busy() || this.disabled) return;
    this.setBusy(true); this.error.set(''); this.message.set('');
    try { await this.load(page); }
    catch (error) { this.showError(error); }
    finally { this.setBusy(false); }
  }

  drop(event: CdkDragDrop<OrderItem[], OrderItem[], OrderItem>) {
    if (event.previousIndex === event.currentIndex) return;
    const item = event.item.data;
    void this.move(item, (this.page - 1) * 20 + event.currentIndex + 1);
  }

  async move(item: OrderItem, position: number | null) {
    const data = this.order();
    if (!data || this.busy() || this.disabled) return;
    if (position === null || !Number.isSafeInteger(position) || position < 1 || position > data.total) {
      this.error.set(`Bitte eine ganze Zielposition zwischen 1 und ${data.total} eingeben.`); return;
    }
    if (position === item.position) return;
    this.setBusy(true); this.error.set(''); this.message.set('');
    let saved = false;
    try {
      await this.auth.request('/api/admin/media/order/move', {
        category: this.category, assetId: item.id, position, token: data.token,
      });
      saved = true;
      this.order.set(null);
      await this.load(Math.ceil(position / 20));
      this.message.set(`"${item.title || 'Bild ohne Bildunterschrift'}" ist jetzt an Position ${position}.`);
    } catch (error) {
      this.showError(error);
      if (saved) this.error.update(message => `Verschiebung gespeichert, aber die neue Reihenfolge konnte nicht geladen werden. ${message}`);
    } finally {
      this.setBusy(false);
      if (saved) this.saved.emit();
    }
  }

  private setBusy(value: boolean) { this.busy.set(value); this.busyChange.emit(value); }
  private showError(error: unknown) { this.error.set(error instanceof Error ? error.message : 'Sortierung fehlgeschlagen. Bitte neu laden.'); }
}
