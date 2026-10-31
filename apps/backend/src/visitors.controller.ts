import { Controller, Get, Inject, Post, Req, Res, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { Public } from './auth/public';
import { PrismaService } from './prisma.service';

export function visitorProof(headers: Request['headers'], secret: string, now = Date.now()): 'external' | 'excluded' | null {
  const proof = headers['x-olconet-visitor-proof'];
  const signature = headers['x-olconet-visitor-signature'];
  if (!secret || typeof proof !== 'string' || typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) return null;
  const match = /^(\d{13}):(external|excluded)$/.exec(proof);
  if (!match || Math.abs(now - Number(match[1])) > 30000) return null;
  const expected = createHmac('sha256', secret).update(proof).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) return null;
  return match[2] === 'external' ? 'external' : 'excluded';
}

export async function visitorTotals(prisma: PrismaService) {
  const enabled = process.env['NODE_ENV'] === 'production' && !!process.env['VISITOR_PROXY_SECRET']
    && !!process.env['VISITOR_EXCLUDED_IPS']?.trim() && !!process.env['VISITOR_TRUSTED_PROXIES']?.trim();
  return { total: await prisma.visitorSession.count(), enabled };
}

@Public()
@Controller('api/public/visitors')
export class VisitorsController {
  private readonly secret = process.env['VISITOR_PROXY_SECRET'] ?? '';
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    if (this.secret && this.secret.length < 32) throw new Error('VISITOR_PROXY_SECRET muss mindestens 32 Zeichen enthalten.');
  }

  @Get()
  async total() {
    return visitorTotals(this.prisma);
  }

  @Post()
  async visit(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const totals = await this.total();
    if (!totals.enabled) return totals;
    const proof = visitorProof(request.headers, this.secret);
    if (!proof) throw new ServiceUnavailableException('Besucherzähler: vertrauenswürdige Proxy-Konfiguration fehlt.');
    if (proof === 'excluded') return this.total();
    const cookies = (request.headers.cookie ?? '').split(';').map(value => value.trim())
      .filter(value => value.startsWith('olconet_visit='));
    const candidate = cookies.length === 1 ? cookies[0].slice('olconet_visit='.length) : '';
    const id = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(candidate) ? candidate : randomUUID();
    await this.prisma.visitorSession.createMany({ data: [{ id }], skipDuplicates: true });
    response.cookie('olconet_visit', id, {
      httpOnly: true, sameSite: 'strict', secure: process.env['SITE_URL']?.startsWith('https://') ?? false,
      path: '/api/public/visitors',
    });
    return this.total();
  }
}
