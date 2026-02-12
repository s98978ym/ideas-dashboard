import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET() {
  const checks: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    env: {
      DATABASE_URL: !!process.env.DATABASE_URL,
      DIRECT_URL: !!process.env.DIRECT_URL,
      TOKEN_ENCRYPTION_KEY: !!process.env.TOKEN_ENCRYPTION_KEY,
      SLACK_CLIENT_ID: !!process.env.SLACK_CLIENT_ID,
    },
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { status: 'connected' };
  } catch (error) {
    checks.database = {
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  try {
    const count = await prisma.workspace.count();
    checks.tables = { status: 'ok', workspace_count: count };
  } catch (error) {
    checks.tables = {
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  const healthy =
    checks.database &&
    (checks.database as Record<string, unknown>).status === 'connected' &&
    checks.tables &&
    (checks.tables as Record<string, unknown>).status === 'ok';

  return NextResponse.json(checks, { status: healthy ? 200 : 503 });
}
