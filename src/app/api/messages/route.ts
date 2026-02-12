/**
 * Message Listing API
 *
 * GET /api/messages - List messages with filters
 *
 * Query params:
 * - workspaceId: Filter by workspace
 * - channelId: Filter by channel (internal DB id)
 * - threadTs: Filter by thread timestamp
 * - since: ISO timestamp for minimum created_at
 * - until: ISO timestamp for maximum created_at
 * - limit: Number of results (default 100, max 1000)
 * - offset: Pagination offset
 * - includeRawJson: Include raw Slack payload (default false)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

/**
 * GET /api/messages
 * List messages with filters
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Parse query parameters
    const workspaceId = searchParams.get('workspaceId');
    const channelId = searchParams.get('channelId');
    const threadTs = searchParams.get('threadTs');
    const since = searchParams.get('since');
    const until = searchParams.get('until');
    const includeRawJson = searchParams.get('includeRawJson') === 'true';

    const limit = Math.min(
      parseInt(searchParams.get('limit') || String(DEFAULT_LIMIT), 10),
      MAX_LIMIT
    );
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // Build where clause
    const where: any = {};

    if (workspaceId) {
      where.workspace_id = workspaceId;
    }

    if (channelId) {
      where.channel_id = channelId;
    }

    if (threadTs) {
      where.thread_ts = threadTs;
    }

    if (since || until) {
      where.created_at = {};
      if (since) {
        where.created_at.gte = new Date(since);
      }
      if (until) {
        where.created_at.lte = new Date(until);
      }
    }

    // Fetch messages
    const [messages, totalCount] = await Promise.all([
      prisma.slackMessage.findMany({
        where,
        select: {
          id: true,
          slack_ts: true,
          slack_channel_id: true,
          workspace_id: true,
          channel_id: true,
          user_id: true,
          user_name: true,
          text: true,
          thread_ts: true,
          is_thread_reply: true,
          event_id: true,
          created_at: true,
          updated_at: true,
          // Only include raw_json if explicitly requested
          raw_json: includeRawJson,
          // Include channel name for convenience
          channel: {
            select: {
              name: true,
              is_private: true,
            },
          },
        },
        orderBy: {
          created_at: 'desc',
        },
        take: limit,
        skip: offset,
      }),
      prisma.slackMessage.count({ where }),
    ]);

    return NextResponse.json({
      messages,
      pagination: {
        total: totalCount,
        limit,
        offset,
        hasMore: offset + limit < totalCount,
      },
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch messages',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
