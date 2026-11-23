import { BadRequestException, Body, Controller, Inject, Logger, Post, Req, Res, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { Request, Response } from 'express';
import { Public } from './auth/public';
import { PrismaService } from './prisma.service';
import { GeoIpService } from './visitor-analytics.service';
import { visitorTrackingEnabled, visitorTrackingTestMode } from './visitor-config';

const SESSION_COOKIE = 'olconet_analytics';
const OPT_OUT_COOKIE = 'olconet_analytics_disabled=1';
const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: process.env['SITE_URL']?.startsWith('https://') ?? false,
  path: '/api/public/visitors',
};
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MAX_PAGE_DURATION_SECONDS = 30 * 60;
const RETENTION_DAYS = 365;
const logger = new Logger('VisitorsController');

export type VisitorProof = { kind: 'excluded' } | { kind: 'external'; ip: string };

export function visitorProof(headers: Request['headers'], secret: string, now = Date.now()): VisitorProof | null {
  const proof = headers['x-olconet-visitor-proof'];
  const signature = headers['x-olconet-visitor-signature'];
  const ipHeader = headers['x-olconet-visitor-ip'];
  if (!secret || typeof proof !== 'string' || typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) return null;
  const match = /^(\d{13}):(external|excluded)$/.exec(proof);
  if (!match || Math.abs(now - Number(match[1])) > 30000) return null;
  if (match[2] === 'external') {
    if (typeof ipHeader !== 'string' || !isIP(ipHeader)) return null;
    const expected = createHmac('sha256', secret).update(`${proof}\n${ipHeader}`).digest();
    return timingSafeEqual(expected, Buffer.from(signature, 'hex')) ? { kind: 'external', ip: ipHeader } : null;
  }
  if (ipHeader !== undefined) return null;
  const expected = createHmac('sha256', secret).update(`${proof}\n`).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex')) ? { kind: 'excluded' } : null;
}

export function validatePagePath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 256 || !value.startsWith('/') ||
      value.startsWith('//') || /[?#\\\u0000-\u001f]/.test(value)) {
    throw new BadRequestException('Ungültiger Seitenpfad.');
  }
  return value;
}

export function validateDuration(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_PAGE_DURATION_SECONDS) {
    throw new BadRequestException('Ungültige Besuchsdauer.');
  }
  return value;
}

export function classifyReferrer(referrer: unknown, siteUrl: string): 'direct' | 'search' | 'referral' {
  if (typeof referrer !== 'string' || !referrer || referrer.length > 2048) return 'direct';
  let hostname: string;
  try {
    const url = new URL(referrer);
    if (!['http:', 'https:'].includes(url.protocol)) return 'direct';
    hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    if (hostname === new URL(siteUrl).hostname.toLowerCase().replace(/^www\./, '')) return 'direct';
  } catch {
    return 'direct';
  }
  return /(^|\.)((google|bing|duckduckgo|yahoo|ecosia|qwant|yandex|baidu)\.[a-z.]+)$/.test(hostname)
    ? 'search' : 'referral';
}

export function visitorProfile(userAgent: string | undefined) {
  const ua = userAgent ?? '';
  const browser = /Edg(?:e|A|iOS)?\//i.test(ua) ? 'Edge'
    : /OPR\//i.test(ua) ? 'Opera'
    : /Firefox\//i.test(ua) ? 'Firefox'
    : /Chrome\//i.test(ua) ? 'Chrome'
    : /Safari\//i.test(ua) ? 'Safari'
    : 'unknown';
  const device = /iPad|Tablet/i.test(ua) ? 'tablet'
    : /Mobile|iPhone|Android/i.test(ua) ? 'mobile'
    : ua ? 'desktop' : 'unknown';
  return { browser, device };
}

@Public()
@Controller('api/public/visitors')
export class VisitorsController {
  private readonly secret = process.env['VISITOR_PROXY_SECRET'] ?? '';
  private lastCleanupAt = 0;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(GeoIpService) private readonly geoIp: GeoIpService,
  ) {
    if (this.secret && this.secret.length < 32) throw new Error('VISITOR_PROXY_SECRET muss mindestens 32 Zeichen enthalten.');
  }

  @Post()
  async track(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    response.clearCookie('olconet_visit', { ...SESSION_COOKIE_OPTIONS, path: '/api/public/visitors' });
    const cookies = (request.headers.cookie ?? '').split(';').map(value => value.trim());
    if (cookies.includes(OPT_OUT_COOKIE)) {
      response.clearCookie(SESSION_COOKIE, SESSION_COOKIE_OPTIONS);
      return { enabled: false };
    }
    if (!visitorTrackingEnabled(process.env)) return { enabled: false };
    const proof = visitorProof(request.headers, this.secret) ?? this.localTestProof(request);
    if (!proof) throw new ServiceUnavailableException('Besuchserfassung: vertrauenswürdige Proxy-Konfiguration fehlt.');
    if (proof.kind === 'excluded') return { enabled: true, excluded: true };

    const input = visitorInput(body);
    const sessionCookies = cookies.filter(value => value.startsWith(`${SESSION_COOKIE}=`));
    const candidate = sessionCookies.length === 1 ? sessionCookies[0].slice(SESSION_COOKIE.length + 1) : '';
    const sessionId = UUID_PATTERN.test(candidate) ? candidate : randomUUID();
    const now = new Date();
    const existing = await this.prisma.visitorSession.findUnique({ where: { id: sessionId }, select: { id: true } });
    if (input.finish) {
      if (existing) {
        await this.cleanupExpired(now);
        await this.prisma.visitorPageView.updateMany({
          where: { id: input.pageViewId, sessionId },
          data: { durationSeconds: input.durationSeconds },
        });
        response.cookie(SESSION_COOKIE, sessionId, SESSION_COOKIE_OPTIONS);
      }
      return { enabled: true };
    }
    if (!existing) {
      const { browser, device } = visitorProfile(request.headers['user-agent']);
      await this.prisma.visitorSession.create({
        data: {
          id: sessionId,
          country: this.geoIp.countryFor(proof.ip),
          source: classifyReferrer(input.referrer, process.env['SITE_URL'] ?? ''),
          device,
          browser,
        },
      });
    }

    await this.cleanupExpired(now);
    if (input.pageViewId && input.durationSeconds !== undefined) {
      await this.prisma.visitorPageView.updateMany({
        where: { id: input.pageViewId, sessionId },
        data: { durationSeconds: input.durationSeconds },
      });
    }

    response.cookie(SESSION_COOKIE, sessionId, SESSION_COOKIE_OPTIONS);

    const pageView = await this.prisma.visitorPageView.create({
      data: { sessionId, path: input.path, enteredAt: now },
      select: { id: true },
    });
    return { enabled: true, pageViewId: pageView.id };
  }

  private async cleanupExpired(now: Date) {
    if (now.getTime() - this.lastCleanupAt < 24 * 60 * 60 * 1000) return;
    try {
      await this.prisma.visitorSession.deleteMany({
        where: { createdAt: { lt: new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000) } },
      });
      this.lastCleanupAt = now.getTime();
    } catch (error) {
      logger.error('Besuchsdaten älter als 365 Tage konnten nicht bereinigt werden.');
      throw error;
    }
  }

  private localTestProof(request: Request): VisitorProof | null {
    if (!visitorTrackingTestMode(process.env)) return null;
    const ip = request.socket.remoteAddress?.replace(/^::ffff:/, '');
    return ip === '127.0.0.1' || ip === '::1' ? { kind: 'external', ip } : null;
  }
}

type VisitorInput =
  | { finish: true; pageViewId: string; durationSeconds: number }
  | { finish: false; path: string; referrer?: string; pageViewId?: string; durationSeconds?: number };

function visitorInput(value: unknown): VisitorInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('Ungültige Besuchsdaten.');
  }
  const body = value as Record<string, unknown>;
  const finish = body['finish'] === true;
  const pageViewId = body['pageViewId'];
  const durationSeconds = body['durationSeconds'] === undefined ? undefined : validateDuration(body['durationSeconds']);
  if (pageViewId !== undefined && (typeof pageViewId !== 'string' || !UUID_PATTERN.test(pageViewId))) {
    throw new BadRequestException('Ungültige Seitenaufruf-ID.');
  }
  if (finish) {
    if (typeof pageViewId !== 'string' || durationSeconds === undefined) {
      throw new BadRequestException('Fehlende Besuchsdauer.');
    }
    return { finish: true, pageViewId, durationSeconds };
  }
  if (durationSeconds !== undefined && (typeof pageViewId !== 'string' || !pageViewId)) {
    throw new BadRequestException('Fehlende Seitenaufruf-ID.');
  }
  return {
    finish: false,
    path: validatePagePath(body['path']),
    ...(typeof body['referrer'] === 'string' ? { referrer: body['referrer'].slice(0, 2048) } : {}),
    ...(typeof pageViewId === 'string' ? { pageViewId } : {}),
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
  };
}
