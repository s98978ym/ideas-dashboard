/**
 * Single Draft Operations
 *
 * GET /api/drafts/[id] - Get draft by ID
 * PUT /api/drafts/[id] - Update draft
 * DELETE /api/drafts/[id] - Delete draft
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * GET /api/drafts/[id]
 * Get a single draft by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const draft = await prisma.draft.findUnique({
      where: { id },
      include: {
        message: {
          select: {
            slack_ts: true,
            slack_channel_id: true,
            user_id: true,
            user_name: true,
            text: true,
            thread_ts: true,
          },
        },
        workspace: {
          select: {
            name: true,
            team_id: true,
          },
        },
        analysis_run: {
          select: {
            id: true,
            status: true,
            recipe_id: true,
          },
        },
      },
    });

    if (!draft) {
      return NextResponse.json(
        { error: 'Draft not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ draft });
  } catch (error) {
    console.error('Error fetching draft:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch draft',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/drafts/[id]
 * Update a draft
 *
 * Body: {
 *   text?: string,
 *   status?: 'draft' | 'sent' | 'copied'
 * }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { text, status } = body;

    // Validation
    if (text !== undefined && (typeof text !== 'string' || text.trim().length === 0)) {
      return NextResponse.json(
        { error: 'text must be a non-empty string if provided' },
        { status: 400 }
      );
    }

    if (status !== undefined && !['draft', 'sent', 'copied'].includes(status)) {
      return NextResponse.json(
        { error: 'status must be draft, sent, or copied' },
        { status: 400 }
      );
    }

    if (text === undefined && status === undefined) {
      return NextResponse.json(
        { error: 'At least one field (text or status) must be provided' },
        { status: 400 }
      );
    }

    // Check if draft exists
    const existingDraft = await prisma.draft.findUnique({
      where: { id },
      select: { id: true, status: true },
    });

    if (!existingDraft) {
      return NextResponse.json(
        { error: 'Draft not found' },
        { status: 404 }
      );
    }

    // Don't allow editing sent drafts
    if (existingDraft.status === 'sent' && text !== undefined) {
      return NextResponse.json(
        { error: 'Cannot edit text of sent drafts' },
        { status: 403 }
      );
    }

    // Build update data
    const updateData: any = {};
    if (text !== undefined) {
      updateData.text = text.trim();
    }
    if (status !== undefined) {
      updateData.status = status;
    }

    // Update draft
    const draft = await prisma.draft.update({
      where: { id },
      data: updateData,
      include: {
        workspace: {
          select: {
            name: true,
            team_id: true,
          },
        },
      },
    });

    return NextResponse.json({ draft });
  } catch (error) {
    console.error('Error updating draft:', error);
    return NextResponse.json(
      {
        error: 'Failed to update draft',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/drafts/[id]
 * Delete a draft
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Check if draft exists
    const draft = await prisma.draft.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!draft) {
      return NextResponse.json(
        { error: 'Draft not found' },
        { status: 404 }
      );
    }

    // Delete draft
    await prisma.draft.delete({
      where: { id },
    });

    return NextResponse.json(
      { message: 'Draft deleted successfully' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error deleting draft:', error);
    return NextResponse.json(
      {
        error: 'Failed to delete draft',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
