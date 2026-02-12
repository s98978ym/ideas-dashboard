/**
 * Slack Channel Backfill
 *
 * Retrieves historical messages from Slack channels using conversations.history API.
 * Supports pagination, rate limiting, and resumable backfill from last position.
 */

import { prisma } from '@/lib/db';
import { getWorkspaceClient, callWithRateLimit, resolveUserNames } from './client';
import { WebClient } from '@slack/web-api';

export interface BackfillOptions {
  oldest?: string; // Unix timestamp
  latest?: string; // Unix timestamp
  limit?: number; // Messages per API call (max 1000)
  inclusive?: boolean;
}

export interface BackfillResult {
  messagesProcessed: number;
  messagesSkipped: number;
  hasMore: boolean;
  oldestTs?: string;
  latestTs?: string;
}

/**
 * Backfill messages from a Slack channel
 *
 * Retrieves historical messages and saves them to the database.
 * Uses cursor-based pagination to handle large channels.
 * Implements rate limiting to respect Slack API tier 3 limits (50+/min).
 *
 * @param workspaceId - Workspace ID (Prisma or Slack team_id)
 * @param channelId - Channel ID (Prisma or Slack channel_id)
 * @param options - Backfill configuration
 * @returns Backfill statistics
 */
export async function backfillChannel(
  workspaceId: string,
  channelId: string,
  options: BackfillOptions = {}
): Promise<BackfillResult> {
  const { oldest, latest, limit = 100, inclusive = true } = options;

  console.log(`[Slack] Starting backfill for channel ${channelId}`);

  // Find workspace and channel
  const workspace = await prisma.workspace.findFirst({
    where: {
      OR: [{ id: workspaceId }, { team_id: workspaceId }],
    },
  });

  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  const channel = await prisma.channel.findFirst({
    where: {
      OR: [
        { id: channelId, workspace_id: workspace.id },
        { slack_channel_id: channelId, workspace_id: workspace.id },
      ],
    },
  });

  if (!channel) {
    throw new Error(`Channel not found: ${channelId}`);
  }

  // Get Slack client
  const client = await getWorkspaceClient(workspace.id);

  let cursor: string | undefined = undefined;
  let messagesProcessed = 0;
  let messagesSkipped = 0;
  let oldestMessageTs: string | undefined = undefined;
  let latestMessageTs: string | undefined = undefined;
  let hasMore = true;

  // Pagination loop
  while (hasMore) {
    try {
      // Call conversations.history API
      const response: any = await client.conversations.history({
          channel: channel.slack_channel_id,
          cursor,
          limit,
          oldest,
          latest,
          inclusive,
        });

      if (!response.ok) {
        throw new Error(
          `Slack API error: ${response.error || 'Unknown error'}`
        );
      }

      const messages = response.messages || [];

      console.log(
        `[Slack] Fetched ${messages.length} messages (cursor: ${cursor || 'initial'})`
      );

      // Batch resolve user names for this page of messages
      const userIds = messages.map((m: any) => m.user).filter(Boolean);
      const userNameMap = await resolveUserNames(client, userIds);

      // Process each message
      for (const message of messages) {
        const processed = await processBackfillMessage(
          workspace.id,
          channel.id,
          message,
          userNameMap
        );

        if (processed) {
          messagesProcessed++;

          // Track oldest and latest timestamps
          if (!oldestMessageTs || message.ts < oldestMessageTs) {
            oldestMessageTs = message.ts;
          }
          if (!latestMessageTs || message.ts > latestMessageTs) {
            latestMessageTs = message.ts;
          }
        } else {
          messagesSkipped++;
        }
      }

      // Check if there are more messages
      hasMore = response.has_more || false;
      cursor = response.response_metadata?.next_cursor;

      // Update channel with last backfill timestamp
      await prisma.channel.update({
        where: { id: channel.id },
        data: {
          last_backfill_ts: oldestMessageTs || null,
        },
      });

      // Rate limiting: wait between API calls
      // Tier 3: 50+ per minute, so we can do ~1 per second safely
      if (hasMore && cursor) {
        await sleep(1200); // 1.2 seconds between calls
      }
    } catch (error) {
      console.error('[Slack] Backfill error:', error);

      // If rate limited, wait and continue
      if (error instanceof Error && error.message.includes('rate_limited')) {
        console.log('[Slack] Rate limited, waiting 60 seconds...');
        await sleep(60000);
        continue;
      }

      // For other errors, re-throw
      throw error;
    }
  }

  console.log(
    `[Slack] Backfill complete: ${messagesProcessed} processed, ${messagesSkipped} skipped`
  );

  return {
    messagesProcessed,
    messagesSkipped,
    hasMore: false,
    oldestTs: oldestMessageTs,
    latestTs: latestMessageTs,
  };
}

/**
 * Resume backfill from last position
 *
 * Uses the stored cursor from the channel record to continue
 * from where the last backfill stopped.
 *
 * @param workspaceId - Workspace ID
 * @param channelId - Channel ID
 * @param options - Additional backfill options
 * @returns Backfill statistics
 */
export async function resumeBackfill(
  workspaceId: string,
  channelId: string,
  options: Omit<BackfillOptions, 'cursor'> = {}
): Promise<BackfillResult> {
  const channel = await prisma.channel.findFirst({
    where: {
      OR: [{ id: channelId }, { slack_channel_id: channelId }],
    },
  });

  if (!channel) {
    throw new Error(`Channel not found: ${channelId}`);
  }

  // Use the stored cursor if available
  const lastBackfillTs = channel.last_backfill_ts;
  const oldestOption = lastBackfillTs || undefined;

  console.log(
    `[Slack] Resuming backfill from ${lastBackfillTs || 'beginning'}`
  );

  return backfillChannel(workspaceId, channelId, {
    ...options,
    oldest: options.oldest || oldestOption,
  });
}

/**
 * Backfill all channels in a workspace
 *
 * Iterates through all channels and backfills each one.
 * Useful for initial workspace setup.
 *
 * @param workspaceId - Workspace ID
 * @param options - Backfill options applied to all channels
 * @returns Map of channel ID to backfill results
 */
export async function backfillAllChannels(
  workspaceId: string,
  options: BackfillOptions = {}
): Promise<Map<string, BackfillResult>> {
  const workspace = await prisma.workspace.findFirst({
    where: {
      OR: [{ id: workspaceId }, { team_id: workspaceId }],
    },
  });

  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  // Get all channels for workspace
  const channels = await prisma.channel.findMany({
    where: {
      workspace_id: workspace.id,
    },
  });

  console.log(
    `[Slack] Starting backfill for ${channels.length} channels in workspace ${workspace.name}`
  );

  const results = new Map<string, BackfillResult>();

  // Process channels sequentially to avoid rate limits
  for (const channel of channels) {
    try {
      console.log(`[Slack] Backfilling channel #${channel.name}`);

      const result = await backfillChannel(workspace.id, channel.id, options);

      results.set(channel.id, result);

      // Wait between channels to be conservative with rate limits
      await sleep(2000);
    } catch (error) {
      console.error(
        `[Slack] Failed to backfill channel #${channel.name}:`,
        error
      );

      results.set(channel.id, {
        messagesProcessed: 0,
        messagesSkipped: 0,
        hasMore: false,
      });
    }
  }

  console.log(`[Slack] Backfill complete for all channels`);

  return results;
}

/**
 * Process a single message from backfill
 *
 * Saves message to database if it doesn't already exist.
 * Returns true if message was saved, false if skipped.
 */
async function processBackfillMessage(
  workspaceId: string,
  channelId: string,
  message: any,
  userNameMap?: Map<string, string>
): Promise<boolean> {
  // Skip messages without timestamp
  if (!message.ts) {
    return false;
  }

  // Skip bot messages unless they have important content
  if (message.bot_id && !message.text?.includes('important')) {
    return false;
  }

  // Skip message subtypes we don't care about
  const skipSubtypes = [
    'channel_join',
    'channel_leave',
    'channel_topic',
    'channel_purpose',
    'channel_name',
    'channel_archive',
    'channel_unarchive',
  ];

  if (message.subtype && skipSubtypes.includes(message.subtype)) {
    return false;
  }

  // Check if message already exists
  const existing = await prisma.slackMessage.findFirst({
    where: {
      workspace_id: workspaceId,
      channel_id: channelId,
      slack_ts: message.ts,
    },
  });

  if (existing) {
    // Message already exists, skip
    return false;
  }

  // Get channel info to get slack_channel_id
  const channelRecord = await prisma.channel.findUnique({
    where: { id: channelId },
  });

  if (!channelRecord) {
    return false;
  }

  // Create message record
  try {
    await prisma.slackMessage.create({
      data: {
        workspace_id: workspaceId,
        channel_id: channelId,
        slack_channel_id: channelRecord.slack_channel_id,
        slack_ts: message.ts,
        thread_ts: message.thread_ts || null,
        is_thread_reply: !!(message.thread_ts && message.thread_ts !== message.ts),
        user_id: message.user || null,
        user_name: message.user && userNameMap ? (userNameMap.get(message.user) || null) : null,
        text: message.text || '',
        raw_json: message,
        created_at: new Date(parseFloat(message.ts) * 1000),
      },
    });

    return true;
  } catch (error) {
    // Handle unique constraint violations (race conditions)
    if (
      error instanceof Error &&
      error.message.includes('Unique constraint')
    ) {
      return false;
    }

    // Log other errors but continue
    console.error('[Slack] Error saving message:', error);
    return false;
  }
}

/**
 * Get backfill status for a channel
 *
 * Returns information about the last backfill and estimated progress.
 */
export async function getBackfillStatus(channelId: string): Promise<{
  lastBackfill: string | null;
  messageCount: number;
  oldestMessage: Date | null;
  latestMessage: Date | null;
}> {
  const channel = await prisma.channel.findFirst({
    where: {
      OR: [{ id: channelId }, { slack_channel_id: channelId }],
    },
  });

  if (!channel) {
    throw new Error(`Channel not found: ${channelId}`);
  }

  const messageCount = await prisma.slackMessage.count({
    where: {
      channel_id: channel.id,
    },
  });

  const oldestMessage = await prisma.slackMessage.findFirst({
    where: {
      channel_id: channel.id,
    },
    orderBy: { created_at: 'asc' },
    select: { created_at: true },
  });

  const latestMessage = await prisma.slackMessage.findFirst({
    where: {
      channel_id: channel.id,
    },
    orderBy: { created_at: 'desc' },
    select: { created_at: true },
  });

  return {
    lastBackfill: channel.last_backfill_ts,
    messageCount,
    oldestMessage: oldestMessage?.created_at || null,
    latestMessage: latestMessage?.created_at || null,
  };
}

/**
 * Sleep utility for rate limiting
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
