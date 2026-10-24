import { closePhotoViewer, enablePhotoViewer } from './photo-viewer';
import { currentLanguage, pagePath, syncLanguageLinks, translations } from '../i18n';

const lang = currentLanguage();
const t = translations(lang);

interface Summary {
  title: string; slug: string; excerpt: string; destination: string | null;
  travelStart: string | null; travelEnd: string | null; publishedAt: string | null;
}
interface ReportPage { id: string; title: string; contentHtml: string; images: {
  assetId: string; caption: string | null; inGallery: boolean; asset: { altText: string; title: string };
}[]; }
interface Report extends Summary { pages: ReportPage[]; }
interface List { items: Summary[]; page: number; pageSize: number; total: number; }

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) {
    throw new Error(response.status === 404 ?
      t('Dieser Reisebericht ist nicht veroeffentlicht oder wurde nicht gefunden.', 'This travel report is not published or could not be found.') :
      t('Reiseberichte konnten nicht geladen werden. Bitte spaeter erneut versuchen.', 'Travel reports could not be loaded. Please try again later.'));
  }
  return await response.json() as T;
}

function metadata(report: Summary) {
  const date = (value: string) => new Date(value).toLocaleDateString(lang === 'en' ? 'en-GB' : 'de-CH', { timeZone: 'UTC' });
  const parts = [report.destination];
  if (report.travelStart) parts.push(`${t('Reisebeginn', 'Travel start')}: ${date(report.travelStart)}`);
  if (report.travelEnd) parts.push(`${t('Reiseende', 'Travel end')}: ${date(report.travelEnd)}`);
  if (report.publishedAt) parts.push(`${t('Veroeffentlicht', 'Published')}: ${date(report.publishedAt)}`);
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
    status.textContent = t('Reiseberichte werden geladen ...', 'Loading travel reports ...');
    status.setAttribute('role', 'status');
    try {
      const result = await fetchJson<List>(`/api/public/reports?page=${target}&lang=${lang}`);
      list.replaceChildren();
      for (const report of result.items) {
        const card = document.createElement('article');
        card.className = 'card';
        const heading = document.createElement('h2');
        const link = document.createElement('a');
        link.href = pagePath(`/reisen/bericht/?slug=${encodeURIComponent(report.slug)}`, lang);
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
      label.textContent = t(`Seite ${page}`, `Page ${page}`);
      status.textContent = result.items.length ? t(`${result.total} Reiseberichte`, `${result.total} travel ${result.total === 1 ? 'report' : 'reports'}`) :
        t('Noch keine veroeffentlichten Reiseberichte auf dieser Seite.', 'No published travel reports on this page yet.');
      previous.disabled = page <= 1;
      next.disabled = page * result.pageSize >= result.total;
    } catch (error) {
      status.setAttribute('role', 'alert');
      status.textContent = error instanceof Error ? error.message : t('Reiseberichte konnten nicht geladen werden.', 'Travel reports could not be loaded.');
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
  const pageRoot = document.getElementById('report-page');
  const pageTitle = document.getElementById('report-page-title');
  const navigation = document.getElementById('report-page-navigation');
  const position = document.getElementById('report-page-position');
  const previous = document.querySelector<HTMLAnchorElement>('#report-page-previous');
  const next = document.querySelector<HTMLAnchorElement>('#report-page-next');
  const select = document.querySelector<HTMLSelectElement>('#report-page-select');
  const retry = document.querySelector<HTMLButtonElement>('#report-retry');
  if (!status || !article || !title || !meta || !excerpt || !content || !gallery || !retry ||
    !pageRoot || !pageTitle || !navigation || !position || !previous || !next || !select) throw new Error('Berichtsansicht ist unvollstaendig.');
  const slug = new URLSearchParams(location.search).get('slug');
  let report: Report | null = null;
  const pageUrl = (id: string) => pagePath(`/reisen/bericht/?slug=${encodeURIComponent(slug!)}&seite=${encodeURIComponent(id)}`, lang);
  const showError = (error: unknown) => {
    article.hidden = true; status.hidden = false;
    status.setAttribute('role', 'alert');
    status.textContent = error instanceof Error ? error.message : t('Reisebericht konnte nicht geladen werden.', 'The travel report could not be loaded.');
    retry.hidden = false;
  };
  const render = (scroll = false) => {
    if (!report?.pages.length) throw new Error(t('Dieser Bericht hat keine veroeffentlichten Seiten.', 'This report has no published pages.'));
    const selected = new URLSearchParams(location.search).get('seite');
    const index = selected ? report.pages.findIndex(page => page.id === selected) : 0;
    const page = report.pages[index];
    if (!page) throw new Error(t('Diese Berichtsseite ist nicht veroeffentlicht oder wurde nicht gefunden.', 'This report page is not published or could not be found.'));
    closePhotoViewer();
    pageTitle.textContent = page.title || t(`Seite ${index + 1}`, `Page ${index + 1}`);
    // Image URLs and alt text are resolved by the API from validated page associations.
    content.innerHTML = page.contentHtml;
    gallery.replaceChildren();
    const images = page.images.filter(image => image.inGallery);
    gallery.hidden = !images.length;
    for (const image of images) {
      const figure = document.createElement('figure');
      const img = document.createElement('img');
      img.src = `/api/public/reports/${encodeURIComponent(report.slug)}/images/${image.assetId}`;
      img.alt = image.asset.altText; img.loading = 'lazy';
      figure.append(img);
      if (image.caption || image.asset.title) {
        const caption = document.createElement('figcaption');
        caption.textContent = image.caption || image.asset.title; figure.append(caption);
      }
      gallery.append(figure);
    }
    for (const image of pageRoot.querySelectorAll('img')) image.addEventListener('error', () => {
      status.hidden = false; status.setAttribute('role', 'alert');
      status.textContent = t('Ein Reisebild ist momentan nicht verfuegbar. Bitte erneut laden.', 'A travel photo is currently unavailable. Please reload.'); retry.hidden = false;
    });
    enablePhotoViewer(pageRoot);
    navigation.hidden = report.pages.length <= 1;
    position.textContent = t(`Seite ${index + 1} von ${report.pages.length}`, `Page ${index + 1} of ${report.pages.length}`);
    select.value = page.id;
    previous.hidden = index === 0;
    next.hidden = index === report.pages.length - 1;
    if (index > 0) previous.href = pageUrl(report.pages[index - 1]!.id);
    if (index < report.pages.length - 1) next.href = pageUrl(report.pages[index + 1]!.id);
    article.hidden = false; status.hidden = true; retry.hidden = true;
    syncLanguageLinks();
    if (scroll) { pageTitle.focus({ preventScroll: true }); pageTitle.scrollIntoView({ block: 'start' }); }
  };
  const navigate = (id: string) => {
    history.pushState(null, '', pageUrl(id));
    try { render(true); } catch (error) { showError(error); }
  };
  for (const link of [previous, next]) link.addEventListener('click', event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(new URL(link.href).searchParams.get('seite')!);
  });
  select.addEventListener('change', () => navigate(select.value));
  window.addEventListener('popstate', () => {
    if (report) { try { render(true); } catch (error) { showError(error); } }
  });
  const load = async () => {
    retry.hidden = true;
    status.hidden = false;
    status.textContent = t('Reisebericht wird geladen ...', 'Loading travel report ...');
    status.setAttribute('role', 'status');
    try {
      if (!slug) throw new Error(t('Der Link enthaelt kein Berichts-Kuerzel.', 'The link does not contain a report slug.'));
      report = await fetchJson<Report>(`/api/public/reports/${encodeURIComponent(slug)}?lang=${lang}`);
      title.textContent = report.title;
      document.title = `${report.title} | olconet`;
      meta.textContent = metadata(report);
      excerpt.textContent = report.excerpt;
      select.replaceChildren();
      for (const [index, page] of report.pages.entries()) {
        const option = document.createElement('option');
        option.value = page.id; option.textContent = `${index + 1}. ${page.title || t('Ohne Seitentitel', 'Untitled page')}`;
        select.append(option);
      }
      render();
    } catch (error) {
      showError(error);
    }
  };
  retry.addEventListener('click', () => void load());
  void load();
}
