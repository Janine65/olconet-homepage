import { BadRequestException } from '@nestjs/common';

export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') throw new BadRequestException('Eine gültige E-Mail-Adresse ist erforderlich.');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException('Eine gültige E-Mail-Adresse ist erforderlich.');
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

export function passwordChangeInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    !('currentPassword' in value) || !('newPassword' in value) ||
    Object.keys(value).some(key => !['currentPassword', 'newPassword'].includes(key))) {
    throw new BadRequestException('Aktuelles und neues Passwort sind erforderlich.');
  }
  const currentPassword = validatePassword(value.currentPassword);
  const newPassword = validatePassword(value.newPassword, true);
  if (currentPassword === newPassword) {
    throw new BadRequestException('Das neue Passwort muss sich vom aktuellen unterscheiden.');
  }
  return { currentPassword, newPassword };
}
