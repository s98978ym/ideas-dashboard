import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const message = await prisma.slackMessage.findUnique({
      where: { id },
      include: {
        channel: { select: { id: true, name: true } },
        workspace: { select: { id: true, name: true } },
      },
    });

    if (!message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    // Find thread replies: messages sharing the same thread_ts in the same channel
    const threadTs = message.thread_ts || message.slack_ts;
    const replies = await prisma.slackMessage.findMany({
      where: {
        channel_id: message.channel_id,
        thread_ts: threadTs,
        id: { not: message.id },
      },
      orderBy: { created_at: 'asc' },
    });

    return NextResponse.json({
      thread: {
        message: {
          id: message.id,
          slack_ts: message.slack_ts,
          text: message.text,
          user_id: message.user_id,
          user_name: message.user_name,
          created_at: message.created_at,
          thread_ts: message.thread_ts,
          is_thread_reply: message.is_thread_reply,
        },
        replies: replies.map((r) => ({
          id: r.id,
          slack_ts: r.slack_ts,
          text: r.text,
          user_id: r.user_id,
          user_name: r.user_name,
          created_at: r.created_at,
          thread_ts: r.thread_ts,
          is_thread_reply: r.is_thread_reply,
        })),
        workspace: { id: message.workspace.id, name: message.workspace.name },
        channel: { id: message.channel.id, name: message.channel.name },
      },
    });
  } catch (error) {
    console.error('Error fetching thread:', error);
    return NextResponse.json(
      { error: 'Failed to fetch thread', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
