/**
 * Prisma Client Singleton
 *
 * Standard pattern for Next.js to prevent multiple instances
 * of PrismaClient during hot reloading in development.
 */

import { PrismaClient } from '@prisma/client';

// Ensure pgbouncer=true is set on DATABASE_URL for Supabase connection pooler compatibility.
// Uses string concatenation instead of URL parsing to avoid corrupting passwords with special characters.
function getDatasourceUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  if (url.includes('pgbouncer=true')) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}pgbouncer=true`;
}

// PrismaClient is attached to the `global` object in development to prevent
// exhausting your database connection limit.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: getDatasourceUrl(),
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/**
 * Gracefully disconnect from database
 * Useful for cleanup in serverless environments or testing
 */
export async function disconnectDB(): Promise<void> {
  await prisma.$disconnect();
}

/**
 * Check database connection health
 * Returns true if connected, false otherwise
 */
export async function checkDBHealth(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    console.error('Database health check failed:', error);
    return false;
  }
}

/**
 * Execute database operations in a transaction
 * Wrapper around Prisma's $transaction with error handling
 */
export async function withTransaction<T>(
  callback: (tx: PrismaClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    return callback(tx as PrismaClient);
  });
}

export default prisma;
