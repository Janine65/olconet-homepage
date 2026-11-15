import { BadRequestException, Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import maxmind from 'maxmind';
import { PrismaService } from './prisma.service';
import { visitorTrackingEnabled } from './visitor-config';

@Injectable()
export class GeoIpService implements OnModuleInit {
  private reader: { get(ip: string): unknown } | undefined;

  async onModuleInit() {
    const path = process.env['GEOIP_COUNTRY_DB'];
    if (!path) return;
    try {
      const reader = await maxmind.open(path);
      if (!reader.metadata.databaseType.includes('Country')) {
        throw new Error('GEOIP_COUNTRY_DB muss auf eine MaxMind Country-Datenbank zeigen.');
      }
      this.reader = reader;
    } catch (error) {
      new Logger('GeoIpService').error('GEOIP_COUNTRY_DB konnte nicht als Country-Datenbank geladen werden.');
      throw error;
    }
  }

  get enabled() {
    return !!this.reader;
  }

  countryFor(ip: string) {
    const result = this.reader?.get(ip);
    if (!result || typeof result !== 'object') return null;
    const country = 'country' in result && result.country && typeof result.country === 'object'
      ? result.country : undefined;
    const registered = 'registered_country' in result && result.registered_country &&
      typeof result.registered_country === 'object' ? result.registered_country : undefined;
    const code = country && 'iso_code' in country && typeof country.iso_code === 'string'
      ? country.iso_code
      : registered && 'iso_code' in registered && typeof registered.iso_code === 'string'
        ? registered.iso_code : null;
    return typeof code === 'string' && /^[A-Z]{2}$/.test(code) ? code : null;
  }
}

interface DateRange {
  from: string;
  to: string;
  start: Date;
  end: Date;
}

interface CountRow {
  label: string;
  count: number;
}

function parseDate(value: string, field: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException(`Ungültiges Datumsfeld: ${field}.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`Ungültiges Datumsfeld: ${field}.`);
  }
  return date;
}

export function visitorDateRange(from?: string, to?: string, now = new Date()): DateRange {
  const today = now.toISOString().slice(0, 10);
  const toDate = parseDate(to ?? today, 'to');
  const fromDate = parseDate(from ?? new Date(toDate.getTime() - 29 * 86400000).toISOString().slice(0, 10), 'from');
  if (fromDate > toDate || toDate > parseDate(today, 'to') || toDate.getTime() - fromDate.getTime() > 364 * 86400000) {
    throw new BadRequestException('Der Zeitraum muss zwischen 1 und 365 Tagen liegen und darf nicht in der Zukunft enden.');
  }
  return {
    from: fromDate.toISOString().slice(0, 10),
    to: toDate.toISOString().slice(0, 10),
    start: fromDate,
    end: new Date(toDate.getTime() + 86400000),
  };
}

function increment(counts: Map<string, number>, key: string) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function rows(counts: Map<string, number>): CountRow[] {
  return [...counts].map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function durationLabel(seconds: number | null) {
  if (seconds === null) return 'Unbekannt';
  if (seconds < 10) return 'Unter 10 Sekunden';
  if (seconds < 30) return '10–29 Sekunden';
  if (seconds < 60) return '30–59 Sekunden';
  if (seconds < 300) return '1–4 Minuten';
  return '5 Minuten und mehr';
}

@Injectable()
export class VisitorAnalyticsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(GeoIpService) private readonly geoIp: GeoIpService,
  ) {}

  async report(from?: string, to?: string) {
    const range = visitorDateRange(from, to);
    const views = await this.prisma.visitorPageView.findMany({
      where: { enteredAt: { gte: range.start, lt: range.end } },
      select: {
        path: true, enteredAt: true, durationSeconds: true,
        session: { select: { id: true, country: true, source: true, device: true, browser: true } },
      },
      orderBy: { enteredAt: 'asc' },
    });

    const sessions = new Map<string, {
      firstViewAt: Date; country: string; source: string; device: string; browser: string;
      durationSeconds: number; durationKnown: boolean;
    }>();
    const pages = new Map<string, number>();
    const durations = new Map<string, number>();
    let totalDuration = 0;
    let durationSessions = 0;

    for (const view of views) {
      const session = sessions.get(view.session.id);
      if (!session) {
        sessions.set(view.session.id, {
          firstViewAt: view.enteredAt, country: view.session.country ?? 'Unbekannt',
          source: view.session.source, device: view.session.device, browser: view.session.browser,
          durationSeconds: 0, durationKnown: false,
        });
      } else if (view.enteredAt < session.firstViewAt) {
        session.firstViewAt = view.enteredAt;
      }
      increment(pages, view.path);
      if (view.durationSeconds !== null) {
        const row = sessions.get(view.session.id)!;
        row.durationSeconds += view.durationSeconds;
        row.durationKnown = true;
      }
    }

    const byDay = new Map<string, number>();
    const byCountry = new Map<string, number>();
    const bySource = new Map<string, number>();
    const byDevice = new Map<string, number>();
    const byBrowser = new Map<string, number>();
    const byWeekday = Array.from({ length: 7 }, () => ({ count: 0 }));
    const byHour = Array.from({ length: 24 }, (_, hour) => ({ label: `${hour}:00`, count: 0 }));
    for (const session of sessions.values()) {
      const at = session.firstViewAt;
      increment(byDay, at.toISOString().slice(0, 10));
      increment(byCountry, session.country);
      increment(bySource, session.source);
      increment(byDevice, session.device);
      increment(byBrowser, session.browser);
      byWeekday[at.getUTCDay()].count++;
      byHour[at.getUTCHours()].count++;
      if (session.durationKnown) {
        totalDuration += session.durationSeconds;
        durationSessions++;
        increment(durations, durationLabel(session.durationSeconds));
      } else {
        increment(durations, durationLabel(null));
      }
    }
    const weekdays = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
    return {
      from: range.from,
      to: range.to,
      enabled: visitorTrackingEnabled(process.env),
      geoIpEnabled: this.geoIp.enabled,
      totalSessions: sessions.size,
      totalPageViews: views.length,
      averageDurationSeconds: durationSessions ? Math.round(totalDuration / durationSessions) : null,
      durationSamples: durationSessions,
      sessionsByDay: [...byDay].sort(([a], [b]) => a.localeCompare(b))
        .map(([label, count]) => ({ label, count })),
      sessionsByCountry: rows(byCountry),
      sessionsBySource: rows(bySource),
      sessionsByWeekday: byWeekday.map((item, index) => ({ label: weekdays[index], count: item.count })),
      sessionsByHour: byHour,
      sessionsByDevice: rows(byDevice),
      sessionsByBrowser: rows(byBrowser),
      pageViewsByPage: rows(pages),
      sessionsByDuration: rows(durations),
    };
  }
}
