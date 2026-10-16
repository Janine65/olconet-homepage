import { ConfigurationError } from '../config';
import { Language } from '../language';

export function readSiteUrl(env: NodeJS.ProcessEnv) {
  const value = env['SITE_URL'] ?? (env['NODE_ENV'] === 'production' ? '' : 'http://localhost:18431');
  let url: URL;
  try { url = new URL(value); } catch { throw new ConfigurationError('SITE_URL muss eine gueltige Homepage-Origin sein.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.origin !== value || url.username || url.password) {
    throw new ConfigurationError('SITE_URL muss eine HTTP(S)-Origin ohne Pfad oder abschliessenden Slash sein.');
  }
  return value;
}

export function xml(value: string) {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function rss(items: { id: string; slug: string; title: string; excerpt: string; publishedAt: Date | null }[], site: string, lang: Language = 'de') {
  const prefix = lang === 'en' ? '/en' : '';
  const feed = '/api/public/reports/rss' + (lang === 'en' ? '?lang=en' : '');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>${lang === 'en' ? 'olconet Travel reports' : 'olconet Reiseberichte'}</title><link>${xml(site + prefix + '/reisen/')}</link>
<description>${lang === 'en' ? "Janine's travel reports" : 'Janines Reiseberichte'}</description><language>${lang}</language>
<atom:link href="${xml(site + feed)}" rel="self" type="application/rss+xml"/>
${items.map((item) => `<item><title>${xml(item.title)}</title>
<link>${xml(site + prefix + '/reisen/bericht/?slug=' + encodeURIComponent(item.slug))}</link>
<guid isPermaLink="false">${xml('urn:olconet:travel:' + item.id)}</guid>
<description>${xml(item.excerpt)}</description>
${item.publishedAt ? `<pubDate>${item.publishedAt.toUTCString()}</pubDate>` : ''}</item>`).join('\n')}
</channel></rss>`;
}
