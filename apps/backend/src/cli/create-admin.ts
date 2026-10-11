import 'dotenv/config';
import { parseArgs } from 'node:util';
import { PrismaService } from '../prisma.service';
import { normalizeEmail, validatePassword } from '../auth/auth.input';
import { hashPassword } from '../auth/password';
import { ConfigurationError } from '../config';
import { Prisma } from '../generated/prisma/client';
import { BadRequestException } from '@nestjs/common';

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      'password-stdin': { type: 'boolean', default: false },
    },
  });
  const email = normalizeEmail(values.email);
  const displayName = values.name?.trim();
  if (!displayName || displayName.length > 100) {
    throw new BadRequestException('--name muss zwischen 1 und 100 Zeichen enthalten.');
  }
  let password: string;
  if (values['password-stdin']) {
    let input = '';
    for await (const chunk of process.stdin) {
      input += String(chunk);
      if (Buffer.byteLength(input) > 130) throw new BadRequestException('Passworteingabe ist zu lang.');
    }
    password = input.replace(/\r?\n$/, '');
  } else {
    if (!process.stdin.isTTY) throw new BadRequestException('Ein Terminal oder --password-stdin ist erforderlich.');
    const { password: passwordPrompt } = await import('@inquirer/prompts');
    password = await passwordPrompt({ message: 'Passwort (mindestens 12 Zeichen):', mask: '*' });
    const confirmation = await passwordPrompt({ message: 'Passwort wiederholen:', mask: '*' });
    if (password !== confirmation) throw new BadRequestException('Die Passwoerter stimmen nicht ueberein.');
  }
  validatePassword(password, true);
  const prisma = new PrismaService();
  try {
    await prisma.adminUser.create({
      data: { email, displayName, passwordHash: await hashPassword(password) },
    });
    console.log(`Verwaltungskonto fuer ${email} angelegt.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  if (error instanceof BadRequestException || error instanceof ConfigurationError) {
    console.error(error.message);
  } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    console.error('Ein Konto mit dieser E-Mail-Adresse existiert bereits.');
  } else if (error instanceof Prisma.PrismaClientKnownRequestError &&
    ['P2021', 'P2022'].includes(error.code)) {
    console.error('Datenbanktabellen fehlen oder sind veraltet. Zuerst pnpm db:deploy im Projektwurzelverzeichnis ausfuehren, danach das Konto erneut anlegen.');
  } else if (error instanceof Error && error.name === 'ExitPromptError') {
    console.error('Kontoeinrichtung abgebrochen.');
  } else {
    console.error('Kontoeinrichtung fehlgeschlagen. Argumente, Datenbankverbindung und Migrationen pruefen.');
  }
  process.exitCode = 1;
});
