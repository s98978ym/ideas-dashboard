import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { syncAllWorkspacesIfStale } from '@/lib/slack/channel-sync';

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get('workspaceId');
    const type = request.nextUrl.searchParams.get('type'); // channel, private_channel, im, mpim, or null for all

    // Sync channels from Slack if stale
    await syncAllWorkspacesIfStale();

    const where: any = { is_monitored: true };
    if (workspaceId) where.workspace_id = workspaceId;
    if (type) where.conversation_type = type;

    const conversations = await prisma.channel.findMany({
      where,
      include: {
        workspace: { select: { name: true, team_id: true } },
        _count: { select: { messages: true } },
      },
      orderBy: { updated_at: 'desc' },
    });

    return NextResponse.json({
      conversations: conversations.map(c => ({
        id: c.id,
        slack_channel_id: c.slack_channel_id,
        name: c.name,
        conversation_type: c.conversation_type,
        is_private: c.is_private,
        is_monitored: c.is_monitored,
        participants: c.participants,
        message_count: c._count.messages,
        workspace: c.workspace,
        last_backfill_ts: c.last_backfill_ts,
        updated_at: c.updated_at,
      })),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to fetch conversations', message: error.message },
      { status: 500 }
    );
  }
}
