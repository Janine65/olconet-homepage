import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';
import { readConfig } from './config';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  readonly databaseSchema: string;

  constructor() {
    const { databaseUrl } = readConfig(process.env);
    const schema = new URL(databaseUrl).searchParams.get('schema') ?? 'public';
    super({
      adapter: new PrismaPg(
        { connectionString: databaseUrl, connectionTimeoutMillis: 3000 },
        { schema },
      ),
    });
    this.databaseSchema = schema;
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
