export type Language = 'de' | 'en';

export function translations(lang: Language) {
  return (de: string, en: string) => lang === 'en' ? en : de;
}

export function pagePath(path: string, lang: Language) {
  return (lang === 'en' ? '/en' : '') + path;
}

export function currentLanguage(): Language {
  return document.documentElement.lang === 'en' ? 'en' : 'de';
}

export function syncLanguageLinks() {
  for (const link of document.querySelectorAll<HTMLAnchorElement | HTMLLinkElement>('[data-language-switch], link[hreflang]')) {
    const target = new URL(link.href);
    target.search = location.search;
    target.hash = location.hash;
    link.href = target.href;
  }
}
