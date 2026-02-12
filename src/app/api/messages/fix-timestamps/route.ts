import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * POST /api/messages/fix-timestamps
 *
 * Fixes created_at for messages where it doesn't match the Slack timestamp.
 * The slack_ts field is a Unix timestamp (e.g., "1612345678.123456") which
 * should be converted to the actual message date.
 */
export async function POST(request: NextRequest) {
  try {
    // Get all messages and check if created_at matches slack_ts
    const messages = await prisma.slackMessage.findMany({
      select: {
        id: true,
        slack_ts: true,
        created_at: true,
      },
    });

    let fixed = 0;

    for (const msg of messages) {
      const tsFloat = parseFloat(msg.slack_ts);
      if (isNaN(tsFloat)) continue;

      const correctDate = new Date(tsFloat * 1000);
      const diff = Math.abs(msg.created_at.getTime() - correctDate.getTime());

      // If difference is more than 60 seconds, fix it
      if (diff > 60000) {
        await prisma.slackMessage.update({
          where: { id: msg.id },
          data: { created_at: correctDate },
        });
        fixed++;
      }
    }

    return NextResponse.json({
      total: messages.length,
      fixed,
      message: `Fixed timestamps for ${fixed} out of ${messages.length} messages.`,
    });
  } catch (error) {
    console.error('Error fixing timestamps:', error);
    return NextResponse.json(
      { error: 'Failed to fix timestamps', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
