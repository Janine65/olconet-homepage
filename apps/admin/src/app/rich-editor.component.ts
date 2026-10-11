import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild } from '@angular/core';
import { Editor, Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { UploadedAsset } from './upload-queue.component';

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
    </div>
    <div #surface class="editor-surface"></div>
  `,
})
export class RichEditorComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() content = '';
  @Input() disabled = false;
  @Input() images: UploadedAsset[] = [];
  @Output() contentChange = new EventEmitter<string>();
  @ViewChild('surface', { static: true }) surface!: ElementRef<HTMLElement>;
  editor?: Editor;

  ngAfterViewInit() {
    this.editor = new Editor({
      element: this.surface.nativeElement,
      extensions: [Node.create({
        name: 'reportImage', group: 'block', content: 'inline*', draggable: true, isolating: true,
        addAttributes: () => ({ assetId: { default: null, rendered: false,
          parseHTML: element => element.querySelector('img')?.getAttribute('data-asset-id') ?? null } }),
        parseHTML: () => [{ tag: 'figure', contentElement: 'figcaption',
          getAttrs: element => element.querySelector('img[data-asset-id]') ? {} : false }],
        renderHTML: ({ node }) => {
          const id = String(node.attrs['assetId']);
          return ['figure', ['img', { 'data-asset-id': id, src: `/api/admin/media/${encodeURIComponent(id)}/image`,
            alt: this.images.find(image => image.id === id)?.altText ?? 'Reisebild' }], ['figcaption', 0]];
        },
      }), StarterKit.configure({
        heading: { levels: [2, 3] }, code: false, codeBlock: false, link: false, underline: false,
      })],
      content: this.content,
      editable: !this.disabled,
      editorProps: { attributes: { role: 'textbox', 'aria-label': 'Berichtstext', 'aria-multiline': 'true' } },
      onUpdate: ({ editor }) => this.contentChange.emit(editor.getHTML()),
    });
  }

  insertImage(image: UploadedAsset, caption: string) {
    if (!this.editor || this.disabled) return;
    this.editor.chain().focus().insertContent({
      type: 'reportImage', attrs: { assetId: image.id },
      content: caption ? [{ type: 'text', text: caption }] : [],
    }).run();
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
