import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild, signal } from '@angular/core';
import { Editor, Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { UploadedAsset } from './upload-queue.component';

export type InlineImageSize = 100 | 250 | 500;
function imageSize(value: unknown): InlineImageSize {
  return value === 100 || value === 250 || value === 500 ? value : 250;
}

@Component({
  selector: 'app-rich-editor',
  standalone: true,
  template: `
    <div class="editor-toolbar" role="toolbar" aria-label="Textformatierung">
      <button type="button" [disabled]="disabled" (click)="editor?.chain().focus().setParagraph().run()">Absatz</button>
      <button type="button" [disabled]="disabled" (click)="editor?.chain().focus().toggleHeading({level: 2}).run()">Ueberschrift</button>
      <button type="button" [disabled]="disabled" (click)="editor?.chain().focus().toggleHeading({level: 3}).run()">Untertitel</button>
      <button type="button" [disabled]="disabled" (click)="editor?.chain().focus().toggleBold().run()">Fett</button>
      <button type="button" [disabled]="disabled" (click)="editor?.chain().focus().toggleItalic().run()">Kursiv</button>
      <button type="button" [disabled]="disabled" (click)="editor?.chain().focus().toggleBulletList().run()">Aufzaehlung</button>
      <button type="button" [disabled]="disabled" (click)="editor?.chain().focus().toggleOrderedList().run()">Nummerierung</button>
      <button type="button" [disabled]="disabled" (click)="editor?.chain().focus().toggleBlockquote().run()">Zitat</button>
      <button type="button" [disabled]="disabled" (click)="editor?.chain().focus().undo().run()">Rueckgaengig</button>
      <button type="button" [disabled]="disabled" (click)="editor?.chain().focus().redo().run()">Wiederholen</button>
      <span>Bildgroesse:</span>
      <button type="button" [disabled]="disabled || selectedImageSize() === null" [attr.aria-pressed]="selectedImageSize() === 100" (click)="resizeImage(100)">Klein (100 x 100)</button>
      <button type="button" [disabled]="disabled || selectedImageSize() === null" [attr.aria-pressed]="selectedImageSize() === 250" (click)="resizeImage(250)">Mittel (250 x 250)</button>
      <button type="button" [disabled]="disabled || selectedImageSize() === null" [attr.aria-pressed]="selectedImageSize() === 500" (click)="resizeImage(500)">Gross (500 x 500)</button>
    </div>
    <div #surface class="editor-surface"></div>
  `,
})
export class RichEditorComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() content = '';
  @Input() disabled = false;
  @Input() images: UploadedAsset[] = [];
  @Input() language: 'de' | 'en' = 'de';
  @Output() contentChange = new EventEmitter<string>();
  @ViewChild('surface', { static: true }) surface!: ElementRef<HTMLElement>;
  editor?: Editor;
  readonly selectedImageSize = signal<InlineImageSize | null>(null);

  ngAfterViewInit() {
    this.editor = new Editor({
      element: this.surface.nativeElement,
      extensions: [Node.create({
        name: 'reportImage', group: 'block', content: 'inline*', draggable: true, isolating: true,
        addAttributes: () => ({ assetId: { default: null, rendered: false,
          parseHTML: element => element.querySelector('img')?.getAttribute('data-asset-id') ?? null },
          size: { default: 250, rendered: false,
            parseHTML: element => imageSize(Number(element.querySelector('img')?.getAttribute('data-image-size') ?? 250)) },
        }),
        parseHTML: () => [{ tag: 'figure', contentElement: 'figcaption',
          getAttrs: element => element.querySelector('img[data-asset-id]') ? {} : false }],
        renderHTML: ({ node }) => {
          const id = String(node.attrs['assetId']);
          const size = imageSize(node.attrs['size']);
          return ['figure', ['img', { 'data-asset-id': id, 'data-image-size': String(size), width: size, height: size,
            src: `/api/admin/media/${encodeURIComponent(id)}/image`,
            alt: (this.language === 'en' ? this.images.find(image => image.id === id)?.altTextEn : '') ||
              this.images.find(image => image.id === id)?.altText || 'Reisebild' }], ['figcaption', 0]];
        },
      }), StarterKit.configure({
        heading: { levels: [2, 3] }, code: false, codeBlock: false, link: false, underline: false,
      })],
      content: this.content,
      editable: !this.disabled,
      editorProps: { attributes: { role: 'textbox', 'aria-label': this.language === 'en' ? 'Berichtstext (Englisch)' : 'Berichtstext',
        lang: this.language, 'aria-multiline': 'true' } },
      onUpdate: ({ editor }) => this.contentChange.emit(editor.getHTML()),
      onTransaction: ({ editor }) => this.selectedImageSize.set(editor.isActive('reportImage') ?
        imageSize(editor.getAttributes('reportImage')['size']) : null),
    });
  }

  insertImage(image: UploadedAsset, caption: string, size: InlineImageSize = 250) {
    if (!this.editor || this.disabled) return;
    this.editor.chain().focus().insertContent({
      type: 'reportImage', attrs: { assetId: image.id, size },
      content: caption ? [{ type: 'text', text: caption }] : [],
    }).run();
  }

  resizeImage(size: InlineImageSize) {
    if (!this.editor || this.disabled || !this.editor.isActive('reportImage')) return;
    this.editor.chain().focus().updateAttributes('reportImage', { size }).run();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (!this.editor) return;
    this.editor.setEditable(!this.disabled, false);
    if (changes['content'] && this.editor.getHTML() !== this.content) {
      this.editor.commands.setContent(this.content, { emitUpdate: false });
    }
  }

  ngOnDestroy() { this.editor?.destroy(); }
}
