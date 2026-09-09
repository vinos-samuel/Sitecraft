import { PrismaClient } from '@prisma/client';

const globalForPrisma = global as unknown as { prisma: PrismaClient };
export const prisma = globalForPrisma.prisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// PR #3 added Lead.businessType to the Prisma schema (and a SQL migration) but
// the Vercel build only ran `prisma generate`, so Neon never got the column.
// Review/Today/Numbers all `findMany()` the full Lead row and 500.
const ADD_BUSINESS_TYPE_SQL =
  `ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "businessType" TEXT`;

let schemaReady: Promise<void> | null = null;

export function ensureLeadSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = prisma
      .$executeRawUnsafe(ADD_BUSINESS_TYPE_SQL)
      .then(() => undefined)
      .catch((err) => {
        schemaReady = null;
        throw err;
      });
  }
  return schemaReady;
}
