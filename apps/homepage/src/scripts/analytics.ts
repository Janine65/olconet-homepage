const endpoint = '/api/public/visitors';
const optOutCookie = 'olconet_analytics_disabled=1';
const trackingAvailable = !import.meta.env.DEV || import.meta.env.PUBLIC_VISITOR_TRACKING_TEST_MODE === 'true';
const pageStartedAt = Date.now();
let pageViewId: string | undefined;
let pageEnded = false;
let optedOutOnPage = false;

function preferenceSaved() {
  return document.cookie.split(';').some(value => value.trim() === optOutCookie);
}

function trackingRejected() {
  return optedOutOnPage || preferenceSaved();
}

function post(body: object, keepalive = false) {
  return fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Olconet-Request': '1' },
    body: JSON.stringify(body),
    keepalive,
  });
}

const startRequest = trackingAvailable && !trackingRejected()
  ? (async () => {
    try {
      const response = await post({ path: location.pathname, referrer: document.referrer });
      if (!response.ok) throw new Error(`Visitor tracking: HTTP ${response.status}`);
      const data: unknown = await response.json();
      if (trackingRejected() || !data || typeof data !== 'object' || !('enabled' in data) || data.enabled !== true ||
          !('pageViewId' in data) || typeof data.pageViewId !== 'string') return;
      pageViewId = data.pageViewId;
    } catch (error) {
      console.error('Visitor tracking unavailable:', error);
    }
  })()
  : undefined;

window.addEventListener('pagehide', () => {
  if (!pageViewId || pageEnded || trackingRejected()) return;
  pageEnded = true;
  const durationSeconds = Math.min(1800, Math.floor((Date.now() - pageStartedAt) / 1000));
  void post({ finish: true, pageViewId, durationSeconds }, true)
    .catch(error => console.error('Visitor duration could not be saved:', error));
});

const settings = document.querySelector<HTMLElement>('[data-analytics-settings]');
const button = settings?.querySelector<HTMLButtonElement>('button');
const status = settings?.querySelector<HTMLElement>('[role="status"]');
if (settings && button && status) {
  const refresh = (failed = false) => {
    const rejected = trackingRejected();
    button.textContent = (rejected ? settings.dataset.allow : settings.dataset.reject) ?? '';
    status.textContent = (failed ? settings.dataset.saveError
      : rejected ? settings.dataset.rejected : settings.dataset.allowed) ?? '';
  };
  window.addEventListener('pageshow', () => refresh());
  window.addEventListener('focus', () => refresh());
  refresh();
  settings.hidden = false;

  button.addEventListener('click', async () => {
    const reject = !trackingRejected();
    if (reject) pageViewId = undefined;
    optedOutOnPage = reject;
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${optOutCookie}; Path=/; SameSite=Strict; Max-Age=${reject ? 31536000 : 0}${secure}`;
    const saved = preferenceSaved();
    refresh(saved !== reject);
    if (!reject || !saved || !trackingAvailable) return;

    // Let an in-flight page view finish setting its cookie before clearing it.
    await startRequest;
    if (!preferenceSaved()) return;
    try {
      const response = await post({}, true);
      if (!response.ok) throw new Error(`Visitor cookie cleanup: HTTP ${response.status}`);
    } catch (error) {
      console.error('Visitor cookie could not be cleared:', error);
    }
  });
}
