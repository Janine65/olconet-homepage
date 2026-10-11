import { BadRequestException } from '@nestjs/common';

export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') throw new BadRequestException('Eine gueltige E-Mail-Adresse ist erforderlich.');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException('Eine gueltige E-Mail-Adresse ist erforderlich.');
  }
  return email;
}

export function validatePassword(value: unknown, newPassword = false): string {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > 128) {
    throw new BadRequestException('Das Passwort muss zwischen 1 und 128 UTF-8-Bytes enthalten.');
  }
  if (newPassword && value.length < 12) {
    throw new BadRequestException('Ein neues Passwort muss mindestens 12 Zeichen enthalten.');
  }
  return value;
}

export function loginInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('E-Mail-Adresse und Passwort sind erforderlich.');
  }
  if (!('email' in value) || !('password' in value) ||
    Object.keys(value).some((key) => !['email', 'password'].includes(key))) {
    throw new BadRequestException('Nur E-Mail-Adresse und Passwort sind erlaubt.');
  }
  return { email: normalizeEmail(value.email), password: validatePassword(value.password) };
}
