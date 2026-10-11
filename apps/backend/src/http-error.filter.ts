import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from './generated/prisma/client';

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpErrorFilter.name);

  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (error instanceof HttpException) {
      response.status(error.getStatus()).json(error.getResponse());
      return;
    }
    if (error && typeof error === 'object' && 'type' in error) {
      if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
        const status = error.type === 'entity.too.large' ? 413 : 400;
        response.status(status).json({ statusCode: status, message: 'Ungueltiger oder zu grosser JSON-Anfrageinhalt.' });
        return;
      }
    }
    // Keine SQL-Parameter, Passwort-Hashes oder Verbindungsdaten protokollieren.
    const databaseError = error instanceof Prisma.PrismaClientKnownRequestError ||
      error instanceof Prisma.PrismaClientInitializationError ||
      error instanceof Prisma.PrismaClientUnknownRequestError;
    this.logger.error(databaseError
      ? 'API-Anfrage fehlgeschlagen; Datenbankverbindung und Migrationsstand pruefen.'
      : 'Unerwarteter API-Fehler. Anwendungskonfiguration und gespeicherte Daten pruefen.');
    const status = databaseError ? 503 : 500;
    response.status(status).json({ statusCode: status, message: 'Der Dienst ist voruebergehend nicht verfuegbar.' });
  }
}
