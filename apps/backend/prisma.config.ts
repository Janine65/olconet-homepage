import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const url = process.env['DATABASE_URL'];
if (!url && (process.argv.includes('migrate') || process.argv.includes('db'))) {
  throw new Error('DATABASE_URL muss fuer Datenbank- und Migrationsbefehle gesetzt sein.');
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  ...(url ? { datasource: { url } } : {}),
});
