interface Summary {
  title: string; slug: string; excerpt: string; destination: string | null;
  travelStart: string | null; travelEnd: string | null; publishedAt: string | null;
}
interface Report extends Summary { contentHtml: string; images: {
  assetId: string; caption: string | null; inGallery: boolean; asset: { altText: string; title: string };
}[]; }
interface List { items: Summary[]; page: number; pageSize: number; total: number; }

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) {
    throw new Error(response.status === 404 ? 'Dieser Reisebericht ist nicht veroeffentlicht oder wurde nicht gefunden.' :
      'Reiseberichte konnten nicht geladen werden. Bitte spaeter erneut versuchen.');
  }
  return await response.json() as T;
}

function metadata(report: Summary) {
  const date = (value: string) => new Date(value).toLocaleDateString('de-CH', { timeZone: 'UTC' });
  const parts = [report.destination];
  if (report.travelStart) parts.push(`Reisebeginn: ${date(report.travelStart)}`);
  if (report.travelEnd) parts.push(`Reiseende: ${date(report.travelEnd)}`);
  if (report.publishedAt) parts.push(`Veroeffentlicht: ${date(report.publishedAt)}`);
  return parts.filter(Boolean).join(' · ');
}

export function loadReportList() {
  const status = document.getElementById('reports-status');
  const list = document.getElementById('reports-list');
  const label = document.getElementById('reports-page');
  const previous = document.querySelector<HTMLButtonElement>('#reports-previous');
  const next = document.querySelector<HTMLButtonElement>('#reports-next');
  const retry = document.querySelector<HTMLButtonElement>('#reports-retry');
  if (!status || !list || !label || !previous || !next || !retry) throw new Error('Berichtsliste ist unvollstaendig.');
  let page = 1;
  let requestedPage = 1;
  const load = async (target: number) => {
    requestedPage = target;
    previous.disabled = next.disabled = true;
    retry.hidden = true;
    status.textContent = 'Reiseberichte werden geladen ...';
    status.setAttribute('role', 'status');
    try {
      const result = await fetchJson<List>(`/api/public/reports?page=${target}`);
      list.replaceChildren();
      for (const report of result.items) {
        const card = document.createElement('article');
        card.className = 'card';
        const heading = document.createElement('h2');
        const link = document.createElement('a');
        link.href = `/reisen/bericht/?slug=${encodeURIComponent(report.slug)}`;
        link.textContent = report.title;
        heading.append(link);
        const meta = document.createElement('p');
        meta.textContent = metadata(report);
        const excerpt = document.createElement('p');
        excerpt.textContent = report.excerpt;
        card.append(heading, meta, excerpt);
        list.append(card);
      }
      page = result.page;
      label.textContent = `Seite ${page}`;
      status.textContent = result.items.length ? `${result.total} Reiseberichte` : 'Noch keine veroeffentlichten Reiseberichte auf dieser Seite.';
      previous.disabled = page <= 1;
      next.disabled = page * result.pageSize >= result.total;
    } catch (error) {
      status.setAttribute('role', 'alert');
      status.textContent = error instanceof Error ? error.message : 'Reiseberichte konnten nicht geladen werden.';
      retry.hidden = false;
    }
  };
  previous.addEventListener('click', () => void load(page - 1));
  next.addEventListener('click', () => void load(page + 1));
  retry.addEventListener('click', () => void load(requestedPage));
  void load(1);
}

export function loadReport() {
  const status = document.getElementById('report-status');
  const article = document.getElementById('report-article');
  const title = document.getElementById('report-title');
  const meta = document.getElementById('report-meta');
  const excerpt = document.getElementById('report-excerpt');
  const content = document.getElementById('report-content');
  const gallery = document.getElementById('report-gallery');
  const retry = document.querySelector<HTMLButtonElement>('#report-retry');
  if (!status || !article || !title || !meta || !excerpt || !content || !gallery || !retry) throw new Error('Berichtsansicht ist unvollstaendig.');
  const slug = new URLSearchParams(location.search).get('slug');
  const load = async () => {
    retry.hidden = true;
    status.hidden = false;
    status.textContent = 'Reisebericht wird geladen ...';
    status.setAttribute('role', 'status');
    try {
      if (!slug) throw new Error('Der Link enthaelt kein Berichts-Kuerzel.');
      const report = await fetchJson<Report>(`/api/public/reports/${encodeURIComponent(slug)}`);
      title.textContent = report.title;
      document.title = `${report.title} | olconet`;
      meta.textContent = metadata(report);
      excerpt.textContent = report.excerpt;
      // Image URLs and alt text are resolved by the API from validated report associations.
      content.innerHTML = report.contentHtml;
      gallery.replaceChildren();
      const images = report.images.filter(image => image.inGallery);
      gallery.hidden = !images.length;
      for (const image of images) {
        const figure = document.createElement('figure');
        const img = document.createElement('img');
        img.src = `/api/public/reports/${encodeURIComponent(report.slug)}/images/${image.assetId}`;
        img.alt = image.asset.altText; img.loading = 'lazy';
        figure.append(img);
        if (image.caption) {
          const caption = document.createElement('figcaption');
          caption.textContent = image.caption; figure.append(caption);
        }
        gallery.append(figure);
      }
      for (const image of article.querySelectorAll('img')) image.addEventListener('error', () => {
        status.hidden = false; status.setAttribute('role', 'alert');
        status.textContent = 'Ein Reisebild ist momentan nicht verfuegbar. Bitte erneut laden.'; retry.hidden = false;
      });
      article.hidden = false;
      status.hidden = true;
    } catch (error) {
      article.hidden = true;
      status.setAttribute('role', 'alert');
      status.textContent = error instanceof Error ? error.message : 'Reisebericht konnte nicht geladen werden.';
      retry.hidden = false;
    }
  };
  retry.addEventListener('click', () => void load());
  void load();
}
