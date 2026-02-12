import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

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
        orderBy: { created_at: 'asc' },
        take: limit,
        skip: offset,
      }),
      prisma.slackMessage.count({ where: { channel_id: id } }),
    ]);

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
        created_at: m.created_at,
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
