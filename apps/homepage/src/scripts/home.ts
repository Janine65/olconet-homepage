import { currentLanguage, pagePath, translations } from '../i18n';
import { fetchJson, metadata, type List } from './reports';

const lang = currentLanguage();
const t = translations(lang);
const imageStatus = document.querySelector<HTMLElement>('[data-home-images-status]');
const reportStatus = document.querySelector<HTMLElement>('[data-home-reports-status]');
const reportList = document.querySelector<HTMLElement>('[data-home-reports]');
const retry = document.querySelector<HTMLButtonElement>('[data-home-reports-retry]');

if (!imageStatus || !reportStatus || !reportList || !retry) {
  throw new Error('Die Startseite ist unvollständig.');
}

function showImageError(error: unknown) {
  console.error('Home page image unavailable:', error);
  imageStatus!.hidden = false;
  imageStatus!.setAttribute('role', 'alert');
  imageStatus!.textContent = t('Ein Vorschaubild konnte nicht geladen werden. Bitte lade die Seite erneut.',
    'A preview image could not be loaded. Please reload the page.');
}

function showImage(image: HTMLImageElement, url: string, alt: string) {
  image.addEventListener('load', () => { image.hidden = false; }, { once: true });
  image.addEventListener('error', () => showImageError(new Error('Preview image request failed')), { once: true });
  image.alt = alt;
  image.src = url;
}

async function loadPreview(image: HTMLImageElement) {
  const category = image.dataset['homeImage'];
  try {
    if (!category) throw new Error('Missing preview category');
    const response = await fetch(`/api/public/media/latest?category=${encodeURIComponent(category)}&lang=${lang}`);
    if (!response.ok) throw new Error(`Preview ${category}: HTTP ${response.status}`);
    const { image: preview }: { image: { url: string; altText: string } | null } = await response.json();
    if (preview) showImage(image, preview.url, preview.altText);
  } catch (error) {
    showImageError(error);
  }
}

async function loadReports() {
  reportStatus!.setAttribute('role', 'status');
  reportStatus!.textContent = t('Reiseberichte werden geladen ...', 'Loading travel reports ...');
  retry!.hidden = true;
  try {
    const result = await fetchJson<List>(`/api/public/reports?page=1&lang=${lang}`);
    reportList!.replaceChildren();
    for (const report of result.items.slice(0, 3)) {
      const card = document.createElement('article');
      card.className = 'card';
      const heading = document.createElement('h3');
      const link = document.createElement('a');
      link.href = pagePath(`/reisen/bericht/?slug=${encodeURIComponent(report.slug)}`, lang);
      link.textContent = report.title;
      heading.append(link);
      const meta = document.createElement('p');
      meta.textContent = metadata(report);
      const excerpt = document.createElement('p');
      excerpt.textContent = report.excerpt;
      card.append(heading, meta, excerpt);
      reportList!.append(card);
    }
    reportStatus!.textContent = result.items.length
      ? ''
      : t('Noch keine Reiseberichte veröffentlicht.', 'No travel reports have been published yet.');
  } catch (error) {
    reportStatus!.setAttribute('role', 'alert');
    reportStatus!.textContent = error instanceof Error ? error.message :
      t('Reiseberichte konnten nicht geladen werden.', 'Travel reports could not be loaded.');
    retry!.hidden = false;
  }
}

for (const image of document.querySelectorAll<HTMLImageElement>('[data-home-image]')) {
  void loadPreview(image);
}
retry.addEventListener('click', () => void loadReports());
void loadReports();
