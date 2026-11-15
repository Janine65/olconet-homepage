const endpoint = '/api/public/visitors';
const pageStartedAt = Date.now();
let pageViewId: string | undefined;
let pageEnded = false;

if (!import.meta.env.DEV || import.meta.env.PUBLIC_VISITOR_TRACKING_TEST_MODE === 'true') {
  void (async () => {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Olconet-Request': '1' },
        body: JSON.stringify({ path: location.pathname, referrer: document.referrer }),
      });
      if (!response.ok) throw new Error(`Visitor tracking: HTTP ${response.status}`);
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object' || !('enabled' in data) || data.enabled !== true ||
          !('pageViewId' in data) || typeof data.pageViewId !== 'string') return;
      pageViewId = data.pageViewId;
    } catch (error) {
      console.error('Visitor tracking unavailable:', error);
    }
  })();

  window.addEventListener('pagehide', () => {
    if (!pageViewId || pageEnded) return;
    pageEnded = true;
    const durationSeconds = Math.min(1800, Math.floor((Date.now() - pageStartedAt) / 1000));
    void fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Olconet-Request': '1' },
      body: JSON.stringify({ finish: true, pageViewId, durationSeconds }),
      keepalive: true,
    }).catch(error => console.error('Visitor duration could not be saved:', error));
  });
}
