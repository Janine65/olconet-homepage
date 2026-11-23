import 'dotenv/config';
import { BadRequestException } from '@nestjs/common';
import { parseArgs } from 'node:util';
import { normalizeEmail } from '../auth/auth.input';
import { hashPassword } from '../auth/password';
import { ConfigurationError } from '../config';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { readPassword } from './read-password';

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      'password-stdin': { type: 'boolean', default: false },
    },
  });
  const email = normalizeEmail(values.email);
  const passwordHash = await hashPassword(await readPassword(values['password-stdin']));
  const prisma = new PrismaService();
  try {
    await prisma.$transaction(async db => {
      const { id } = await db.adminUser.update({ where: { email }, data: { passwordHash }, select: { id: true } });
      await db.adminSession.deleteMany({ where: { userId: id } });
    });
    console.log(`Passwort für ${email} zurückgesetzt. Alle Sitzungen wurden beendet.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  if (error instanceof BadRequestException || error instanceof ConfigurationError) {
    console.error(error.message);
  } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
    console.error('Kein Verwaltungskonto mit dieser E-Mail-Adresse gefunden.');
  } else if (error instanceof Error && error.name === 'ExitPromptError') {
    console.error('Passwort-Reset abgebrochen.');
  } else {
    console.error('Passwort-Reset fehlgeschlagen. Argumente, Datenbankverbindung und Migrationen prüfen.');
  }
  process.exitCode = 1;
});
