import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getWorkspaceClient, resolveUserNames } from '@/lib/slack/client';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '200', 10), 1000);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const channel = await prisma.channel.findUnique({
      where: { id },
      include: {
        workspace: { select: { id: true, name: true } },
      },
    });

    if (!channel) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const [messages, totalCount] = await Promise.all([
      prisma.slackMessage.findMany({
        where: { channel_id: id },
        orderBy: { slack_ts: 'asc' },
        take: limit,
        skip: offset,
      }),
      prisma.slackMessage.count({ where: { channel_id: id } }),
    ]);

    // Resolve missing user names from Slack API and fix timestamps in background
    const needsUserName = messages.filter((m) => m.user_id && !m.user_name);
    if (needsUserName.length > 0) {
      try {
        const client = await getWorkspaceClient(channel.workspace.id);
        const userIds = [...new Set(needsUserName.map((m) => m.user_id!))];
        const nameMap = await resolveUserNames(client, userIds);

        // Update DB in background and patch local data
        for (const msg of needsUserName) {
          const name = nameMap.get(msg.user_id!);
          if (name) {
            msg.user_name = name;
            prisma.slackMessage.update({
              where: { id: msg.id },
              data: { user_name: name },
            }).catch(() => {});
          }
        }
      } catch {
        // If Slack API fails, continue with what we have
      }
    }

    // Fix incorrect timestamps in background
    for (const msg of messages) {
      const correctDate = new Date(parseFloat(msg.slack_ts) * 1000);
      if (Math.abs(msg.created_at.getTime() - correctDate.getTime()) > 60000) {
        msg.created_at = correctDate;
        prisma.slackMessage.update({
          where: { id: msg.id },
          data: { created_at: correctDate },
        }).catch(() => {});
      }
    }

    return NextResponse.json({
      channel: {
        id: channel.id,
        slack_channel_id: channel.slack_channel_id,
        name: channel.name,
        conversation_type: channel.conversation_type,
        participants: channel.participants,
      },
      workspace: { id: channel.workspace.id, name: channel.workspace.name },
      messages: messages.map((m) => ({
        id: m.id,
        slack_ts: m.slack_ts,
        text: m.text,
        user_id: m.user_id,
        user_name: m.user_name,
        created_at: new Date(parseFloat(m.slack_ts) * 1000).toISOString(),
        thread_ts: m.thread_ts,
        is_thread_reply: m.is_thread_reply,
      })),
      pagination: {
        total: totalCount,
        limit,
        offset,
        hasMore: offset + limit < totalCount,
      },
    });
  } catch (error) {
    console.error('Error fetching conversation messages:', error);
    return NextResponse.json(
      { error: 'Failed to fetch messages', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
