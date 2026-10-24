import { currentLanguage, translations } from '../i18n';
import { enablePhotoViewer } from './photo-viewer';

const lang = currentLanguage();
const t = translations(lang);

interface GalleryItem { id: string; title: string; altText: string; description: string | null; children: { id: string }[]; }
interface GalleryPage { items: GalleryItem[]; total: number; }

for (const root of document.querySelectorAll<HTMLElement>('[data-gallery]')) {
  const status = root.querySelector<HTMLElement>('[data-gallery-status]')!;
  const items = root.querySelector<HTMLElement>('[data-gallery-items]')!;
  const previous = root.querySelector<HTMLButtonElement>('[data-gallery-previous]')!;
  const next = root.querySelector<HTMLButtonElement>('[data-gallery-next]')!;
  const retry = root.querySelector<HTMLButtonElement>('[data-gallery-retry]')!;
  const pageLabel = root.querySelector<HTMLElement>('[data-gallery-page]')!;
  let page = 1;
  async function load() {
    previous.disabled = true; next.disabled = true; retry.hidden = true;
    status.setAttribute('role', 'status');
    status.textContent = t('Bilder werden geladen ...', 'Loading photos ...');
    items.replaceChildren();
    try {
      const response = await fetch(`/api/public/media?category=${encodeURIComponent(root.dataset['gallery']!)}&page=${page}&lang=${lang}`);
      if (!response.ok) throw new Error(t('Die Galerie konnte nicht geladen werden. Bitte erneut versuchen.', 'The gallery could not be loaded. Please try again.'));
      const data: GalleryPage = await response.json();
      for (const asset of data.items) {
        const figure = document.createElement('figure');
        const photos = document.createElement('div');
        photos.className = 'gallery-photos';
        if (asset.children.length) {
          figure.classList.add('gallery-group');
          photos.dataset['photoGroup'] = '';
          photos.setAttribute('role', 'group');
          photos.setAttribute('aria-label', asset.title || t('Fotogruppe', 'Photo group'));
        }
        for (const photo of [asset, ...asset.children]) {
          const image = document.createElement('img');
          image.src = `/api/public/media/${encodeURIComponent(photo.id)}/image`;
          image.alt = asset.altText;
          image.loading = 'lazy';
          image.addEventListener('error', () => {
            status.setAttribute('role', 'alert');
            status.textContent = t('Ein Bild ist momentan nicht verfuegbar. Bitte die Galerie erneut laden.', 'A photo is currently unavailable. Please reload the gallery.');
            retry.hidden = false;
          });
          photos.append(image);
        }
        const caption = document.createElement('figcaption');
        if (asset.title) {
          const title = document.createElement('h2');
          title.textContent = asset.title;
          caption.append(title);
        }
        if (asset.description) {
          const description = document.createElement('p');
          description.textContent = asset.description;
          caption.append(description);
        }
        figure.append(photos);
        if (caption.childElementCount) figure.append(caption);
        items.append(figure);
      }
      enablePhotoViewer(items);
      status.textContent = data.total ? t(`${data.total} ${data.total === 1 ? 'Galerieeintrag' : 'Galerieeintraege'} (Einzelbilder und Fotogruppen)`,
        `${data.total} gallery ${data.total === 1 ? 'entry' : 'entries'} (individual photos and photo groups)`) :
        t('Hier sind noch keine Bilder veroeffentlicht.', 'No photos have been published here yet.');
      pageLabel.textContent = t(`Seite ${page}`, `Page ${page}`);
      previous.disabled = page <= 1;
      next.disabled = page * 20 >= data.total;
    } catch (error) {
      status.setAttribute('role', 'alert');
      status.textContent = error instanceof Error ? error.message : t('Die Galerie konnte nicht geladen werden.', 'The gallery could not be loaded.');
      retry.hidden = false;
    }
  }
  previous.addEventListener('click', () => { page--; void load(); });
  next.addEventListener('click', () => { page++; void load(); });
  retry.addEventListener('click', () => { void load(); });
  void load();
}
