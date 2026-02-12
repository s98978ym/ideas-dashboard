/**
 * Inbox API
 *
 * GET /api/messages/inbox - List inbox items for current user
 * PUT /api/messages/inbox - Mark items as read/archived
 *
 * Inbox items are messages flagged for user attention (mentions, keywords, rules)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * GET /api/messages/inbox
 * List inbox items with filters
 *
 * Query params:
 * - userId: User ID (required for now, TODO: get from auth session)
 * - unread: Filter by read status (true/false)
 * - reason: Filter by reason (mention, keyword, rule, related)
 * - workspaceId: Filter by workspace
 * - limit: Number of results (default 50)
 * - offset: Pagination offset
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const userId = searchParams.get('userId');
    const unreadParam = searchParams.get('unread');
    const reason = searchParams.get('reason');
    const workspaceId = searchParams.get('workspaceId');
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // TODO: Get userId from authenticated session
    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    // Build where clause
    const where: any = {
      user_id: userId,
      is_archived: false, // Don't show archived by default
    };

    if (unreadParam !== null) {
      where.is_read = unreadParam === 'false';
    }

    if (reason) {
      where.reason = reason;
    }

    if (workspaceId) {
      where.message = {
        workspace_id: workspaceId,
      };
    }

    // Fetch inbox items with message details
    const [inboxItems, totalCount] = await Promise.all([
      prisma.inboxItem.findMany({
        where,
        select: {
          id: true,
          message_id: true,
          user_id: true,
          reason: true,
          is_read: true,
          is_archived: true,
          created_at: true,
          // Include message details
          message: {
            select: {
              id: true,
              slack_ts: true,
              slack_channel_id: true,
              workspace_id: true,
              user_id: true,
              user_name: true,
              text: true,
              thread_ts: true,
              is_thread_reply: true,
              created_at: true,
              channel: {
                select: {
                  name: true,
                  is_private: true,
                },
              },
              workspace: {
                select: {
                  name: true,
                  team_id: true,
                },
              },
            },
          },
        },
        orderBy: {
          created_at: 'desc',
        },
        take: limit,
        skip: offset,
      }),
      prisma.inboxItem.count({ where }),
    ]);

    // Count unread items
    const unreadCount = await prisma.inboxItem.count({
      where: {
        user_id: userId,
        is_read: false,
        is_archived: false,
      },
    });

    return NextResponse.json({
      inbox_items: inboxItems,
      unread_count: unreadCount,
      pagination: {
        total: totalCount,
        limit,
        offset,
        hasMore: offset + limit < totalCount,
      },
    });
  } catch (error) {
    console.error('Error fetching inbox items:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch inbox items',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/messages/inbox
 * Mark inbox items as read or archived
 *
 * Body: {
 *   ids: string[],
 *   action: 'read' | 'unread' | 'archive' | 'unarchive'
 * }
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { ids, action } = body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { error: 'ids array is required and must not be empty' },
        { status: 400 }
      );
    }

    if (!['read', 'unread', 'archive', 'unarchive'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action. Must be read, unread, archive, or unarchive' },
        { status: 400 }
      );
    }

    // Build update data based on action
    const updateData: any = {};

    switch (action) {
      case 'read':
        updateData.is_read = true;
        break;
      case 'unread':
        updateData.is_read = false;
        break;
      case 'archive':
        updateData.is_archived = true;
        updateData.is_read = true; // Auto-mark as read when archiving
        break;
      case 'unarchive':
        updateData.is_archived = false;
        break;
    }

    // Update all specified inbox items
    const result = await prisma.inboxItem.updateMany({
      where: {
        id: {
          in: ids,
        },
      },
      data: updateData,
    });

    return NextResponse.json({
      updated_count: result.count,
      action,
    });
  } catch (error) {
    console.error('Error updating inbox items:', error);
    return NextResponse.json(
      {
        error: 'Failed to update inbox items',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
