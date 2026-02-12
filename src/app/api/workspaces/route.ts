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
        encrypted_user_token: true,
        last_dm_sync_at: true,
        dm_sync_enabled: true,
        created_at: true,
        updated_at: true,
        channels: {
          select: {
            id: true,
            slack_channel_id: true,
            name: true,
            is_private: true,
            is_monitored: true,
          },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: {
        created_at: 'desc',
      },
    });

    // Transform response - never expose encrypted tokens
    const workspacesForClient = workspaces.map((workspace) => ({
      id: workspace.id,
      team_id: workspace.team_id,
      name: workspace.name,
      status: workspace.status,
      has_user_token: !!workspace.encrypted_user_token,
      last_dm_sync_at: workspace.last_dm_sync_at,
      dm_sync_enabled: workspace.dm_sync_enabled,
      scopes: workspace.scopes,
      installed_by: workspace.installed_by,
      created_at: workspace.created_at,
      updated_at: workspace.updated_at,
      channels: workspace.channels,
    }));

    return NextResponse.json({
      workspaces: workspacesForClient,
      count: workspacesForClient.length,
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
