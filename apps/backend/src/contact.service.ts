import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import nodemailer from 'nodemailer';

const logger = new Logger('ContactService');
const MAX_RATE_LIMIT_KEYS = 5000;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_PER_EMAIL = 3;

interface ContactSettings {
  enabled: boolean;
  siteKey: string;
  secretKey: string;
  recipient: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  smtpFrom: string;
}

interface ContactMessage {
  name: string;
  email: string;
  message: string;
  turnstileToken: string;
}

interface TurnstileResult {
  success?: boolean;
  action?: string;
  hostname?: string;
}

export function readContactSettings(env: NodeJS.ProcessEnv): ContactSettings {
  const siteKey = env['TURNSTILE_SITE_KEY'] ?? '';
  const secretKey = env['TURNSTILE_SECRET_KEY'] ?? '';
  const recipient = env['CONTACT_RECIPIENT'] ?? 'janine@olconet.com';
  const smtpHost = env['SMTP_HOST'] ?? '';
  const smtpPort = Number(env['SMTP_PORT'] ?? '587');
  const smtpUser = env['SMTP_USER'] ?? '';
  const smtpPassword = env['SMTP_PASSWORD'] ?? '';
  const smtpFrom = env['SMTP_FROM'] ?? '';
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
    throw new Error('SMTP_PORT muss eine ganze Zahl zwischen 1 und 65535 sein.');
  }
  const enabled = !!siteKey && !!secretKey && !!recipient && !!smtpHost && !!smtpUser && !!smtpPassword && !!smtpFrom;
  return { enabled, siteKey, secretKey, recipient, smtpHost, smtpPort, smtpUser, smtpPassword, smtpFrom };
}

export function validateContactMessage(value: unknown): ContactMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('Bitte überprüfe deine Eingaben.');
  }
  const body = value as Record<string, unknown>;
  const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
  const email = typeof body['email'] === 'string' ? body['email'].trim() : '';
  const message = typeof body['message'] === 'string' ? body['message'].trim() : '';
  const turnstileToken = typeof body['turnstileToken'] === 'string' ? body['turnstileToken'] : '';
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name) ||
      email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !message || message.length > 5000 || !turnstileToken || turnstileToken.length > 2048) {
    throw new BadRequestException('Bitte überprüfe Name, E-Mail-Adresse und Nachricht.');
  }
  return { name, email, message, turnstileToken };
}

export async function verifyTurnstile(
  token: string,
  settings: ContactSettings,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const form = new FormData();
  form.set('secret', settings.secretKey);
  form.set('response', token);
  let response: Response;
  try {
    response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    logger.error('Cloudflare Turnstile konnte nicht erreicht werden.');
    throw new ServiceUnavailableException('Der Spam-Schutz ist vorübergehend nicht erreichbar. Bitte später erneut versuchen.');
  }
  if (!response.ok) {
    logger.error('Cloudflare Turnstile hat eine unerwartete HTTP-Antwort geliefert.');
    throw new ServiceUnavailableException('Der Spam-Schutz ist vorübergehend nicht erreichbar. Bitte später erneut versuchen.');
  }
  let result: TurnstileResult;
  try {
    result = await response.json() as TurnstileResult;
  } catch {
    logger.error('Cloudflare Turnstile hat eine ungültige Antwort geliefert.');
    throw new ServiceUnavailableException('Der Spam-Schutz ist vorübergehend nicht erreichbar. Bitte später erneut versuchen.');
  }
  const expectedHostname = new URL(process.env['SITE_URL'] ?? '').hostname;
  if (result.success !== true || result.action !== 'contact' || result.hostname !== expectedHostname) {
    throw new BadRequestException('Bitte bestätige den Spam-Schutz erneut.');
  }
}

export function consumeContactRateLimit(emailAttempts: Map<string, number[]>, email: string, now = Date.now()) {
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  for (const [key, timestamps] of emailAttempts) {
    const current = timestamps.filter(timestamp => timestamp > cutoff);
    if (current.length) emailAttempts.set(key, current);
    else emailAttempts.delete(key);
  }
  const key = createHash('sha256').update(email.toLowerCase()).digest('hex');
  const attempts = emailAttempts.get(key) ?? [];
  if (attempts.length >= RATE_LIMIT_PER_EMAIL || (!emailAttempts.has(key) && emailAttempts.size >= MAX_RATE_LIMIT_KEYS)) {
    throw new HttpException(
      'Für diese E-Mail-Adresse wurden zu viele Nachrichten gesendet. Bitte später erneut versuchen.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
  attempts.push(now);
  emailAttempts.set(key, attempts);
}

@Injectable()
export class ContactService {
  private readonly settings = readContactSettings(process.env);
  private readonly transporter = this.settings.enabled
    ? nodemailer.createTransport({
      host: this.settings.smtpHost,
      port: this.settings.smtpPort,
      secure: this.settings.smtpPort === 465,
      auth: { user: this.settings.smtpUser, pass: this.settings.smtpPassword },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    })
    : undefined;
  private readonly emailAttempts = new Map<string, number[]>();

  configuration() {
    return this.settings.enabled
      ? { enabled: true, siteKey: this.settings.siteKey }
      : { enabled: false };
  }

  async send(value: unknown) {
    if (!this.settings.enabled || !this.transporter) {
      throw new ServiceUnavailableException('Das Kontaktformular ist derzeit nicht verfügbar.');
    }
    const message = validateContactMessage(value);
    await verifyTurnstile(message.turnstileToken, this.settings);
    consumeContactRateLimit(this.emailAttempts, message.email);
    try {
      await this.transporter.sendMail({
        from: this.settings.smtpFrom,
        to: this.settings.recipient,
        replyTo: { name: message.name, address: message.email },
        subject: 'Neue Nachricht über das olconet-Kontaktformular',
        text: `Name: ${message.name}\nE-Mail: ${message.email}\n\n${message.message}`,
      });
    } catch {
      logger.error('Der Versand einer Kontaktanfrage über SMTP ist fehlgeschlagen.');
      throw new ServiceUnavailableException('Deine Nachricht konnte gerade nicht versendet werden. Bitte später erneut versuchen.');
    }
    return { sent: true };
  }

}
