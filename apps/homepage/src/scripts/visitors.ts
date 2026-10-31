import { currentLanguage, translations } from '../i18n';

const output = document.querySelector<HTMLElement>('[data-visitors]');
const lang = currentLanguage();
const t = translations(lang);
if (output) {
  void (async () => {
    try {
      const response = await fetch('/api/public/visitors', {
        method: import.meta.env.DEV ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Olconet-Request': '1' },
        ...(import.meta.env.DEV ? {} : { body: '{}' }),
      });
      if (!response.ok) throw new Error(`Visitor counter: HTTP ${response.status}`);
      const data: { total: number; enabled: boolean } = await response.json();
      if (!Number.isSafeInteger(data.total) || data.total < 0 || typeof data.enabled !== 'boolean') {
        throw new Error('Invalid visitor counter response');
      }
      output.textContent = ` \u00b7 ${t('Besuche', 'Visits')}: ${data.total.toLocaleString(lang)}${
        data.enabled ? '' : t(' (Erfassung deaktiviert)', ' (counting disabled)')}`;
    } catch (error) {
      console.error('Visitor counter unavailable:', error);
      output.textContent = ` \u00b7 ${t('Besucherzaehler nicht verfuegbar', 'Visitor counter unavailable')}`;
    }
  })();
}
