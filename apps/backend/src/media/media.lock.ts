import { Prisma } from '../generated/prisma/client';

export async function lockMedia(db: Prisma.TransactionClient, schema: string, ids: string[]) {
  if (!ids.length) return;
  // Stable row locks serialize attachment with category changes and deletion.
  await db.$queryRaw(Prisma.sql`SELECT "id" FROM ${Prisma.raw(`"${schema.replace(/"/g, '""')}"."MediaAsset"`)}
    WHERE "id" IN (${Prisma.join([...ids].sort().map(id => Prisma.sql`${id}::uuid`))}) ORDER BY "id" FOR UPDATE`);
}
