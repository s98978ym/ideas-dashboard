/**
 * Workspace Management API
 *
 * GET /api/workspaces - List all workspaces
 *
 * Security: Never return decrypted tokens in responses
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * GET /api/workspaces
 * List all workspaces with safe fields only
 */
export async function GET(request: NextRequest) {
  try {
    const workspaces = await prisma.workspace.findMany({
      select: {
        id: true,
        team_id: true,
        name: true,
        status: true,
        scopes: true,
        installed_by: true,
        created_at: true,
        updated_at: true,
        // Count channels for this workspace
        _count: {
          select: {
            channels: true,
          },
        },
      },
      orderBy: {
        created_at: 'desc',
      },
    });

    // Transform response to include channel_count
    const workspacesWithCount = workspaces.map((workspace) => ({
      id: workspace.id,
      team_id: workspace.team_id,
      team_name: workspace.name,
      status: workspace.status,
      channel_count: workspace._count.channels,
      scopes: workspace.scopes,
      installed_by: workspace.installed_by,
      created_at: workspace.created_at,
      updated_at: workspace.updated_at,
    }));

    return NextResponse.json({
      workspaces: workspacesWithCount,
      count: workspacesWithCount.length,
    });
  } catch (error) {
    console.error('Error fetching workspaces:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch workspaces',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
