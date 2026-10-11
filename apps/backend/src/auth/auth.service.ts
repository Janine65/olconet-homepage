import { createHash, randomBytes } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { verifyPassword } from './password';
import { Prisma } from '../generated/prisma/client';

export const SESSION_SECONDS = 8 * 60 * 60;
export const SESSION_COOKIE = 'olconet_session';
export const publicUserSelect = { id: true, email: true, displayName: true } as const;
export type AuthUser = { id: string; email: string; displayName: string };

export function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function sessionToken(cookie: string | undefined) {
  const values = (cookie ?? '').split(';').map((part) => part.trim())
    .filter((part) => part.startsWith(`${SESSION_COOKIE}=`));
  if (values.length !== 1) return null;
  const value = values[0].slice(SESSION_COOKIE.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

@Injectable()
export class AuthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async limit(key: string, maximum: number) {
    // SQL-Identifikatoren lassen sich nicht binden; Schema sicher quotieren.
    const table = Prisma.raw(`"${this.prisma.databaseSchema.replace(/"/g, '""')}"."LoginThrottle"`);
    const rows = await this.prisma.$queryRaw<{ attempts: number }[]>`
      INSERT INTO ${table} AS throttle ("key", "attempts", "expiresAt")
      VALUES (${key}, 1, NOW() + INTERVAL '15 minutes')
      ON CONFLICT ("key") DO UPDATE SET
        "attempts" = CASE WHEN throttle."expiresAt" <= NOW()
          THEN 1 ELSE throttle."attempts" + 1 END,
        "expiresAt" = CASE WHEN throttle."expiresAt" <= NOW()
          THEN NOW() + INTERVAL '15 minutes' ELSE throttle."expiresAt" END
      RETURNING "attempts"
    `;
    if (rows[0].attempts > maximum) {
      throw new HttpException('Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  async login(email: string, password: string, previousToken: string | null) {
    await this.prisma.loginThrottle.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    // Persistente globale und kontobezogene Limits gelten auch nach Neustarts.
    await this.limit('global', 100);
    await this.limit(`email:${tokenHash(email)}`, 10);
    const user = await this.prisma.adminUser.findUnique({ where: { email } });
    if (!await verifyPassword(password, user?.passwordHash ?? null) || !user) {
      throw new UnauthorizedException('E-Mail-Adresse oder Passwort ist falsch.');
    }
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000);
    await this.prisma.$transaction(async (db) => {
      await db.adminSession.deleteMany({ where: { expiresAt: { lte: new Date() } } });
      if (previousToken) await db.adminSession.deleteMany({ where: { tokenHash: tokenHash(previousToken) } });
      await db.adminSession.create({ data: { tokenHash: tokenHash(token), userId: user.id, expiresAt } });
    });
    return { token, user: { id: user.id, email: user.email, displayName: user.displayName } };
  }

  async userForToken(token: string | null): Promise<AuthUser | null> {
    if (!token) return null;
    const session = await this.prisma.adminSession.findUnique({
      where: { tokenHash: tokenHash(token) },
      include: { user: { select: publicUserSelect } },
    });
    return session && session.expiresAt > new Date() ? session.user : null;
  }

  async logout(token: string | null) {
    if (token) await this.prisma.adminSession.deleteMany({ where: { tokenHash: tokenHash(token) } });
  }
}
