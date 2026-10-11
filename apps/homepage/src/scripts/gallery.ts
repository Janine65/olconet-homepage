interface GalleryItem { id: string; title: string; altText: string; description: string | null; }
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
    status.textContent = 'Bilder werden geladen ...';
    items.replaceChildren();
    try {
      const response = await fetch(`/api/public/media?category=${encodeURIComponent(root.dataset['gallery']!)}&page=${page}`);
      if (!response.ok) throw new Error('Die Galerie konnte nicht geladen werden. Bitte erneut versuchen.');
      const data: GalleryPage = await response.json();
      for (const asset of data.items) {
        const figure = document.createElement('figure');
        const image = document.createElement('img');
        image.src = `/api/public/media/${encodeURIComponent(asset.id)}/image`;
        image.alt = asset.altText;
        image.loading = 'lazy';
        image.addEventListener('error', () => {
          status.setAttribute('role', 'alert');
          status.textContent = 'Ein Bild ist momentan nicht verfuegbar. Bitte die Galerie erneut laden.';
          retry.hidden = false;
        });
        const caption = document.createElement('figcaption');
        const title = document.createElement('h2');
        title.textContent = asset.title;
        caption.append(title);
        if (asset.description) {
          const description = document.createElement('p');
          description.textContent = asset.description;
          caption.append(description);
        }
        figure.append(image, caption);
        items.append(figure);
      }
      status.textContent = data.total ? `${data.total} Bilder` : 'Hier sind noch keine Bilder veroeffentlicht.';
      pageLabel.textContent = `Seite ${page}`;
      previous.disabled = page <= 1;
      next.disabled = page * 20 >= data.total;
    } catch (error) {
      status.setAttribute('role', 'alert');
      status.textContent = error instanceof Error ? error.message : 'Die Galerie konnte nicht geladen werden.';
      retry.hidden = false;
    }
  }
  previous.addEventListener('click', () => { page--; void load(); });
  next.addEventListener('click', () => { page++; void load(); });
  retry.addEventListener('click', () => { void load(); });
  void load();
}
