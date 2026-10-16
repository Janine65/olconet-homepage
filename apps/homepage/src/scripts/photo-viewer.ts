import { currentLanguage, translations } from '../i18n';

const t = translations(currentLanguage());
let activePhotos: HTMLImageElement[] = [];
let activeIndex = 0;

function viewerElements() {
  const dialog = document.querySelector<HTMLDialogElement>('[data-photo-viewer]');
  const image = dialog?.querySelector<HTMLImageElement>('[data-photo-viewer-image]');
  const status = dialog?.querySelector<HTMLElement>('[data-photo-viewer-status]');
  const navigation = dialog?.querySelector<HTMLElement>('[data-photo-viewer-navigation]');
  const previous = dialog?.querySelector<HTMLButtonElement>('[data-photo-viewer-previous]');
  const next = dialog?.querySelector<HTMLButtonElement>('[data-photo-viewer-next]');
  const position = dialog?.querySelector<HTMLElement>('[data-photo-viewer-position]');
  if (!dialog || !image || !status || !navigation || !previous || !next || !position) {
    throw new Error('Die Foto-Grossansicht ist unvollstaendig.');
  }
  return { dialog, image, status, navigation, previous, next, position };
}

function showActivePhoto() {
  const photo = activePhotos[activeIndex];
  if (!photo) throw new Error('Das ausgewaehlte Foto ist nicht in der Fotogruppe.');
  const { image, status, navigation, previous, next, position } = viewerElements();
  navigation.hidden = activePhotos.length <= 1;
  previous.disabled = activeIndex === 0;
  next.disabled = activeIndex === activePhotos.length - 1;
  position.textContent = t(`Foto ${activeIndex + 1} von ${activePhotos.length}`, `Photo ${activeIndex + 1} of ${activePhotos.length}`);
  status.setAttribute('role', 'status');
  status.textContent = t('Foto wird geladen ...', 'Loading photo ...');
  status.hidden = false;
  image.hidden = true;
  image.alt = photo.alt;
  image.src = photo.src;
}

function movePhoto(direction: -1 | 1) {
  const target = activeIndex + direction;
  if (target < 0 || target >= activePhotos.length) return;
  activeIndex = target;
  showActivePhoto();
}

export function closePhotoViewer() {
  const { dialog } = viewerElements();
  if (dialog.open) dialog.close();
}

export function initializePhotoViewer() {
  const { dialog, image, status, navigation, previous, next, position } = viewerElements();
  previous.addEventListener('click', () => movePhoto(-1));
  next.addEventListener('click', () => movePhoto(1));
  document.addEventListener('keydown', event => {
    if (!dialog.open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      dialog.close();
    } else if (activePhotos.length > 1 && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      movePhoto(event.key === 'ArrowLeft' ? -1 : 1);
    }
  });
  image.addEventListener('load', () => {
    if (!dialog.open) return;
    image.hidden = false;
    status.hidden = true;
  });
  image.addEventListener('error', () => {
    if (!dialog.open) return;
    image.hidden = true;
    status.setAttribute('role', 'alert');
    status.textContent = t('Das Foto konnte nicht geladen werden. Bitte die Grossansicht schliessen und erneut versuchen.',
      'The photo could not be loaded. Please close the full-screen view and try again.');
    status.hidden = false;
  });
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    document.documentElement.classList.remove('photo-viewer-open');
    image.removeAttribute('src');
    image.alt = '';
    image.hidden = true;
    status.hidden = true;
    navigation.hidden = true;
    position.textContent = '';
    activePhotos = [];
    activeIndex = 0;
  });
}

export function enablePhotoViewer(root: HTMLElement) {
  for (const photo of root.querySelectorAll<HTMLImageElement>('img')) {
    if (photo.closest('.photo-zoom')) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'photo-zoom';
    button.setAttribute('aria-label', t(`Foto vergroessern: ${photo.alt}`, `Enlarge photo: ${photo.alt}`));
    button.setAttribute('aria-haspopup', 'dialog');
    photo.replaceWith(button);
    button.append(photo);
    button.addEventListener('click', () => {
      const group = photo.closest<HTMLElement>('[data-photo-group]');
      const photos = group ? [...group.querySelectorAll<HTMLImageElement>('img')] : [photo];
      activePhotos = [...new Map(photos.map(image => [image.src, image])).values()];
      activeIndex = activePhotos.findIndex(image => image.src === photo.src);
      const { dialog } = viewerElements();
      dialog.showModal();
      document.documentElement.classList.add('photo-viewer-open');
      showActivePhoto();
    });
  }
}
