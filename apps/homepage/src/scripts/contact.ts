import { currentLanguage, translations } from '../i18n';

interface TurnstileApi {
  render(container: HTMLElement, options: {
    sitekey: string;
    action: string;
    callback: (token: string) => void;
    'expired-callback': () => void;
    'error-callback': () => void;
  }): string;
  reset(widgetId?: string): void;
}

declare global {
  interface Window { turnstile?: TurnstileApi; }
}

const form = document.querySelector<HTMLFormElement>('#contact-form');
if (form) initializeContactForm(form);

function initializeContactForm(form: HTMLFormElement) {
  const fieldset = form.querySelector('fieldset');
  const status = form.querySelector<HTMLElement>('[data-contact-status]');
  const widgetTarget = form.querySelector<HTMLElement>('[data-turnstile-widget]');
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!fieldset || !status || !widgetTarget || !button) {
    console.error('Contact form markup is incomplete.');
    return;
  }

  const t = translations(currentLanguage());
  let token = '';
  let widgetId: string | undefined;

  const showError = (message: string) => {
    status.textContent = message;
    status.setAttribute('role', 'alert');
  };
  const loadTurnstile = async () => {
    if (window.turnstile) return;
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Cloudflare Turnstile failed to load'));
      document.head.append(script);
    });
    if (!window.turnstile) throw new Error('Cloudflare Turnstile API is unavailable');
  };

  void (async () => {
    try {
      const response = await fetch('/api/public/contact/config');
      if (!response.ok) throw new Error(`Contact configuration: HTTP ${response.status}`);
      const config: unknown = await response.json();
      if (!config || typeof config !== 'object' || !('enabled' in config) || config.enabled !== true ||
          !('siteKey' in config) || typeof config.siteKey !== 'string' || !config.siteKey) {
        throw new Error('Contact form is not configured');
      }
      fieldset.disabled = false;
      await loadTurnstile();
      widgetId = window.turnstile!.render(widgetTarget, {
        sitekey: config.siteKey,
        action: 'contact',
        callback: value => {
          token = value;
          button.disabled = false;
        },
        'expired-callback': () => {
          token = '';
          button.disabled = true;
        },
        'error-callback': () => {
          token = '';
          button.disabled = true;
          showError(t('Der Spam-Schutz konnte nicht geladen werden. Bitte lade die Seite neu.',
            'Spam protection could not be loaded. Please reload the page.'));
        },
      });
      status.textContent = '';
      status.setAttribute('role', 'status');
    } catch (error) {
      console.error('Contact form unavailable:', error);
      showError(t('Das Kontaktformular ist derzeit nicht verfügbar. Bitte schreibe direkt an janine@olconet.com.',
        'The contact form is currently unavailable. Please email janine@olconet.com directly.'));
    }
  })();

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!token || button.disabled) return;
    button.disabled = true;
    status.textContent = t('Nachricht wird gesendet …', 'Sending message …');
    status.setAttribute('role', 'status');
    const values = new FormData(form);
    try {
      const response = await fetch('/api/public/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Olconet-Request': '1' },
        body: JSON.stringify({
          name: values.get('name'),
          email: values.get('email'),
          message: values.get('message'),
          turnstileToken: token,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        const message = response.status === 429
          ? t('Zu viele Nachrichten. Bitte warte etwas und versuche es erneut.', 'Too many messages. Please wait a while and try again.')
          : response.status === 400
            ? t('Bitte überprüfe deine Angaben und bestätige den Spam-Schutz erneut.', 'Please check your details and confirm spam protection again.')
            : t('Die Nachricht konnte nicht gesendet werden. Bitte versuche es später erneut.', 'The message could not be sent. Please try again later.');
        status.textContent = message;
        status.setAttribute('role', 'alert');
        window.turnstile?.reset(widgetId);
        token = '';
        return;
      }
      form.reset();
      token = '';
      window.turnstile?.reset(widgetId);
      status.textContent = t('Danke für deine Nachricht. Sie wurde gesendet.', 'Thank you for your message. It has been sent.');
      status.setAttribute('role', 'status');
    } catch (error) {
      console.error('Contact message could not be sent:', error);
      showError(t('Die Nachricht konnte nicht gesendet werden. Bitte versuche es später erneut.',
        'The message could not be sent. Please try again later.'));
      window.turnstile?.reset(widgetId);
      token = '';
    } finally {
      button.disabled = !token;
    }
  });
}
