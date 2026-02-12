/**
 * TODO Management API
 *
 * GET /api/todos - List TODOs with filters
 * POST /api/todos - Create a new TODO
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * GET /api/todos
 * List TODOs with filters
 *
 * Query params:
 * - status: Filter by status (open, doing, done)
 * - assignee: Filter by assigned user ID
 * - limit: Number of results (default 100)
 * - offset: Pagination offset
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const status = searchParams.get('status');
    const assignee = searchParams.get('assignee');
    const limit = parseInt(searchParams.get('limit') || '100', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // Build where clause
    const where: any = {};

    if (status) {
      where.status = status;
    }

    if (assignee) {
      where.assigned_to = assignee;
    }

    // Fetch TODOs
    const [todos, totalCount] = await Promise.all([
      prisma.todoItem.findMany({
        where,
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          source_message_id: true,
          analysis_run_id: true,
          assigned_to: true,
          due_date: true,
          created_at: true,
          updated_at: true,
          // Include source message if exists
          source_message: {
            select: {
              slack_ts: true,
              slack_channel_id: true,
              text: true,
              user_name: true,
              workspace_id: true,
              channel: {
                select: {
                  name: true,
                },
              },
            },
          },
          // Include analysis run if exists
          analysis_run: {
            select: {
              id: true,
              recipe_id: true,
              status: true,
            },
          },
        },
        orderBy: [
          { status: 'asc' }, // open first, then doing, then done
          { created_at: 'desc' },
        ],
        take: limit,
        skip: offset,
      }),
      prisma.todoItem.count({ where }),
    ]);

    // Count by status
    const statusCounts = await prisma.todoItem.groupBy({
      by: ['status'],
      _count: true,
      where: assignee ? { assigned_to: assignee } : undefined,
    });

    const counts = {
      open: 0,
      doing: 0,
      done: 0,
    };

    statusCounts.forEach((item) => {
      if (item.status === 'open' || item.status === 'doing' || item.status === 'done') {
        counts[item.status] = item._count;
      }
    });

    return NextResponse.json({
      todos,
      counts,
      pagination: {
        total: totalCount,
        limit,
        offset,
        hasMore: offset + limit < totalCount,
      },
    });
  } catch (error) {
    console.error('Error fetching TODOs:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch TODOs',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/todos
 * Create a new TODO
 *
 * Body: {
 *   title: string (required),
 *   description?: string,
 *   assigned_to?: string,
 *   due_date?: string (ISO date),
 *   source_message_id?: string,
 *   analysis_run_id?: string
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      title,
      description,
      assigned_to,
      due_date,
      source_message_id,
      analysis_run_id,
    } = body;

    // Validation
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return NextResponse.json(
        { error: 'title is required and must be a non-empty string' },
        { status: 400 }
      );
    }

    // Parse due_date if provided
    let parsedDueDate: Date | undefined;
    if (due_date) {
      try {
        parsedDueDate = new Date(due_date);
        if (isNaN(parsedDueDate.getTime())) {
          throw new Error('Invalid date');
        }
      } catch {
        return NextResponse.json(
          { error: 'due_date must be a valid ISO date string' },
          { status: 400 }
        );
      }
    }

    // Create TODO
    const todo = await prisma.todoItem.create({
      data: {
        title: title.trim(),
        description: description?.trim() || null,
        assigned_to: assigned_to || null,
        due_date: parsedDueDate || null,
        source_message_id: source_message_id || null,
        analysis_run_id: analysis_run_id || null,
        status: 'open',
      },
      include: {
        source_message: {
          select: {
            slack_ts: true,
            slack_channel_id: true,
            text: true,
            channel: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    return NextResponse.json(
      {
        todo,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating TODO:', error);
    return NextResponse.json(
      {
        error: 'Failed to create TODO',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
