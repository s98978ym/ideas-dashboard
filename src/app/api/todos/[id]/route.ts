/**
 * Single TODO Operations
 *
 * GET /api/todos/[id] - Get TODO by ID
 * PUT /api/todos/[id] - Update TODO
 * DELETE /api/todos/[id] - Delete TODO
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * GET /api/todos/[id]
 * Get a single TODO by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const todo = await prisma.todoItem.findUnique({
      where: { id },
      include: {
        source_message: {
          select: {
            id: true,
            slack_ts: true,
            slack_channel_id: true,
            text: true,
            user_name: true,
            workspace_id: true,
            channel: {
              select: {
                name: true,
                workspace: {
                  select: {
                    name: true,
                    team_id: true,
                  },
                },
              },
            },
          },
        },
        analysis_run: {
          select: {
            id: true,
            recipe_id: true,
            status: true,
            created_at: true,
          },
        },
      },
    });

    if (!todo) {
      return NextResponse.json(
        { error: 'TODO not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ todo });
  } catch (error) {
    console.error('Error fetching TODO:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch TODO',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/todos/[id]
 * Update a TODO
 *
 * Body: {
 *   title?: string,
 *   description?: string,
 *   status?: 'open' | 'doing' | 'done',
 *   assigned_to?: string,
 *   due_date?: string (ISO date) or null
 * }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { title, description, status, assigned_to, due_date } = body;

    // Validation
    if (title !== undefined && (typeof title !== 'string' || title.trim().length === 0)) {
      return NextResponse.json(
        { error: 'title must be a non-empty string if provided' },
        { status: 400 }
      );
    }

    if (status !== undefined && !['open', 'doing', 'done'].includes(status)) {
      return NextResponse.json(
        { error: 'status must be open, doing, or done' },
        { status: 400 }
      );
    }

    // Check if TODO exists
    const existingTodo = await prisma.todoItem.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existingTodo) {
      return NextResponse.json(
        { error: 'TODO not found' },
        { status: 404 }
      );
    }

    // Parse due_date if provided
    let parsedDueDate: Date | null | undefined;
    if (due_date !== undefined) {
      if (due_date === null) {
        parsedDueDate = null;
      } else {
        try {
          parsedDueDate = new Date(due_date);
          if (isNaN(parsedDueDate.getTime())) {
            throw new Error('Invalid date');
          }
        } catch {
          return NextResponse.json(
            { error: 'due_date must be a valid ISO date string or null' },
            { status: 400 }
          );
        }
      }
    }

    // Build update data
    const updateData: any = {};
    if (title !== undefined) {
      updateData.title = title.trim();
    }
    if (description !== undefined) {
      updateData.description = description ? description.trim() : null;
    }
    if (status !== undefined) {
      updateData.status = status;
    }
    if (assigned_to !== undefined) {
      updateData.assigned_to = assigned_to || null;
    }
    if (parsedDueDate !== undefined) {
      updateData.due_date = parsedDueDate;
    }

    // Update TODO
    const todo = await prisma.todoItem.update({
      where: { id },
      data: updateData,
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

    return NextResponse.json({ todo });
  } catch (error) {
    console.error('Error updating TODO:', error);
    return NextResponse.json(
      {
        error: 'Failed to update TODO',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/todos/[id]
 * Delete a TODO
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Check if TODO exists
    const todo = await prisma.todoItem.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!todo) {
      return NextResponse.json(
        { error: 'TODO not found' },
        { status: 404 }
      );
    }

    // Delete TODO
    await prisma.todoItem.delete({
      where: { id },
    });

    return NextResponse.json(
      { message: 'TODO deleted successfully' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error deleting TODO:', error);
    return NextResponse.json(
      {
        error: 'Failed to delete TODO',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
