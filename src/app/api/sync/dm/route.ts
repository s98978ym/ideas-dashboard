import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { syncWorkspaceDMs } from '@/lib/slack/dm-sync';

// POST /api/sync/dm - Trigger DM sync for all active workspaces
export async function POST(request: NextRequest) {
  try {
    // Verify QStash signature in production, or allow manual trigger
    const authHeader = request.headers.get('authorization');
    const isQStash = request.headers.get('upstash-signature');
    const isBearerAuth = authHeader === `Bearer ${process.env.QSTASH_TOKEN}`;

    // In production, require some form of auth
    if (process.env.NODE_ENV === 'production' && !isQStash && !isBearerAuth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const workspaces = await prisma.workspace.findMany({
      where: {
        status: 'active',
        dm_sync_enabled: true,
        encrypted_user_token: { not: null },
      },
      select: { id: true, name: true, team_id: true },
    });

    const results: Record<string, any> = {};

    for (const ws of workspaces) {
      console.log(`[DM Sync] Starting sync for workspace ${ws.name} (${ws.team_id})`);
      try {
        results[ws.team_id] = await syncWorkspaceDMs(ws.id);
      } catch (err: any) {
        results[ws.team_id] = { error: err.message };
      }
    }

    return NextResponse.json({ success: true, results });
  } catch (error: any) {
    console.error('[DM Sync] Error:', error);
    return NextResponse.json(
      { error: 'DM sync failed', message: error.message },
      { status: 500 }
    );
  }
}
