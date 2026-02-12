import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getWorkspaceClient, resolveUserNames } from '@/lib/slack/client';

/**
 * POST /api/messages/backfill-usernames
 *
 * Resolves Slack user IDs to display names for messages that have null user_name.
 * Processes in batches per workspace.
 */
export async function POST(request: NextRequest) {
  try {
    // Find messages with user_id but no user_name
    const messages = await prisma.slackMessage.findMany({
      where: {
        user_id: { not: null },
        user_name: null,
      },
      select: {
        id: true,
        user_id: true,
        workspace_id: true,
      },
      take: 500,
    });

    if (messages.length === 0) {
      return NextResponse.json({ updated: 0, message: 'No messages need username resolution' });
    }

    // Group by workspace
    const byWorkspace = new Map<string, typeof messages>();
    for (const msg of messages) {
      const list = byWorkspace.get(msg.workspace_id) || [];
      list.push(msg);
      byWorkspace.set(msg.workspace_id, list);
    }

    let totalUpdated = 0;

    for (const [workspaceId, msgs] of byWorkspace) {
      try {
        const client = await getWorkspaceClient(workspaceId);
        const userIds = [...new Set(msgs.map((m) => m.user_id!))];
        const nameMap = await resolveUserNames(client, userIds);

        // Batch update messages
        for (const msg of msgs) {
          const name = nameMap.get(msg.user_id!);
          if (name) {
            await prisma.slackMessage.update({
              where: { id: msg.id },
              data: { user_name: name },
            });
            totalUpdated++;
          }
        }
      } catch (err) {
        console.error(`[Backfill] Failed for workspace ${workspaceId}:`, err);
      }
    }

    // Check if more remain
    const remaining = await prisma.slackMessage.count({
      where: { user_id: { not: null }, user_name: null },
    });

    return NextResponse.json({
      updated: totalUpdated,
      remaining,
      message: remaining > 0
        ? `Updated ${totalUpdated} messages. ${remaining} remaining - call again to continue.`
        : `Done! Updated ${totalUpdated} messages.`,
    });
  } catch (error) {
    console.error('Error backfilling usernames:', error);
    return NextResponse.json(
      { error: 'Failed to backfill usernames', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
