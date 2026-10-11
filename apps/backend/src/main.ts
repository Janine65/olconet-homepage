import 'reflect-metadata';
import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigurationError, readConfig } from './config';
import { readAuthConfig } from './auth/auth.config';
import { configureHttp } from './http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { readSiteUrl } from './travel/rss';

async function bootstrap() {
  const { port } = readConfig(process.env);
  readAuthConfig(process.env);
  readSiteUrl(process.env);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  configureHttp(app);
  app.enableShutdownHooks();
  await app.listen(port, '0.0.0.0');
}

bootstrap().catch((error: unknown) => {
  // Verbindungs-URLs koennen Zugangsdaten enthalten und werden nicht protokolliert.
  Logger.error(error instanceof ConfigurationError
    ? error.message
    : 'Backend-Start fehlgeschlagen. Konfiguration und Laufzeitumgebung pruefen.');
  process.exitCode = 1;
});
