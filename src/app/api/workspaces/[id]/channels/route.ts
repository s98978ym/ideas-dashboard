/**
 * Channel Management API
 *
 * GET /api/workspaces/[id]/channels - List channels for a workspace
 * PUT /api/workspaces/[id]/channels - Update channel monitoring status
 *
 * Fetches from Slack API if cache is stale, stores in database
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { decryptToken } from '@/lib/crypto/tokens';

const CHANNEL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface SlackChannel {
  id: string;
  name: string;
  is_private: boolean;
  is_member?: boolean;
}

/**
 * Fetch channels from Slack API
 */
async function fetchSlackChannels(
  botToken: string
): Promise<SlackChannel[]> {
  const response = await fetch(
    'https://slack.com/api/conversations.list?types=public_channel,private_channel&exclude_archived=true&limit=1000',
    {
      headers: {
        Authorization: `Bearer ${botToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Slack API error: ${response.statusText}`);
  }

  const data = await response.json();

  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error || 'Unknown error'}`);
  }

  return data.channels || [];
}

/**
 * GET /api/workspaces/[id]/channels
 * List channels, refresh from Slack if stale
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: workspaceId } = await params;

    // Fetch workspace with encrypted token
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        team_id: true,
        name: true,
        encrypted_bot_token: true,
        status: true,
      },
    });

    if (!workspace) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      );
    }

    if (workspace.status !== 'active') {
      return NextResponse.json(
        { error: 'Workspace is not active' },
        { status: 403 }
      );
    }

    if (!workspace.encrypted_bot_token) {
      return NextResponse.json(
        { error: 'Workspace has no bot token configured' },
        { status: 400 }
      );
    }

    // Check if we need to refresh from Slack
    const existingChannels = await prisma.channel.findMany({
      where: { workspace_id: workspaceId },
      orderBy: { name: 'asc' },
    });

    const shouldRefresh =
      existingChannels.length === 0 ||
      existingChannels.some(
        (ch) =>
          !ch.updated_at ||
          Date.now() - ch.updated_at.getTime() > CHANNEL_CACHE_TTL_MS
      );

    let channels = existingChannels;

    if (shouldRefresh) {
      try {
        // Decrypt token and fetch from Slack
        const botToken = decryptToken(workspace.encrypted_bot_token);
        const slackChannels = await fetchSlackChannels(botToken);

        // Upsert channels in database
        const upsertPromises = slackChannels.map((slackChannel) =>
          prisma.channel.upsert({
            where: {
              workspace_id_slack_channel_id: {
                workspace_id: workspaceId,
                slack_channel_id: slackChannel.id,
              },
            },
            create: {
              slack_channel_id: slackChannel.id,
              workspace_id: workspaceId,
              name: slackChannel.name,
              is_private: slackChannel.is_private,
              is_monitored: true,
              conversation_type: slackChannel.is_private ? 'private_channel' : 'channel',
            },
            update: {
              name: slackChannel.name,
              is_private: slackChannel.is_private,
              conversation_type: slackChannel.is_private ? 'private_channel' : 'channel',
              updated_at: new Date(),
            },
          })
        );

        channels = await Promise.all(upsertPromises);
      } catch (slackError) {
        console.error('Error fetching from Slack API:', slackError);
        // Fall back to cached data if Slack fetch fails
        if (existingChannels.length > 0) {
          channels = existingChannels;
        } else {
          return NextResponse.json(
            {
              error: 'Failed to fetch channels from Slack',
              message:
                slackError instanceof Error
                  ? slackError.message
                  : 'Unknown error',
            },
            { status: 502 }
          );
        }
      }
    }

    // Return safe channel data
    const channelData = channels.map((ch) => ({
      id: ch.id,
      slack_channel_id: ch.slack_channel_id,
      name: ch.name,
      is_private: ch.is_private,
      is_monitored: ch.is_monitored,
      last_backfill_ts: ch.last_backfill_ts,
      created_at: ch.created_at,
      updated_at: ch.updated_at,
    }));

    return NextResponse.json({
      channels: channelData,
      count: channelData.length,
      workspace: {
        id: workspace.id,
        team_id: workspace.team_id,
        name: workspace.name,
      },
    });
  } catch (error) {
    console.error('Error fetching channels:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch channels',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/workspaces/[id]/channels
 * Update channel monitoring status
 *
 * Body: { channel_id: string, is_monitored: boolean }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: workspaceId } = await params;
    const body = await request.json();

    const { channel_id, is_monitored } = body;

    if (!channel_id || typeof is_monitored !== 'boolean') {
      return NextResponse.json(
        { error: 'Missing or invalid channel_id or is_monitored' },
        { status: 400 }
      );
    }

    // Verify channel belongs to this workspace
    const channel = await prisma.channel.findUnique({
      where: { id: channel_id },
      select: { workspace_id: true },
    });

    if (!channel) {
      return NextResponse.json(
        { error: 'Channel not found' },
        { status: 404 }
      );
    }

    if (channel.workspace_id !== workspaceId) {
      return NextResponse.json(
        { error: 'Channel does not belong to this workspace' },
        { status: 403 }
      );
    }

    // Update monitoring status
    const updatedChannel = await prisma.channel.update({
      where: { id: channel_id },
      data: { is_monitored },
    });

    return NextResponse.json({
      channel: {
        id: updatedChannel.id,
        slack_channel_id: updatedChannel.slack_channel_id,
        name: updatedChannel.name,
        is_monitored: updatedChannel.is_monitored,
      },
    });
  } catch (error) {
    console.error('Error updating channel:', error);
    return NextResponse.json(
      {
        error: 'Failed to update channel',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
