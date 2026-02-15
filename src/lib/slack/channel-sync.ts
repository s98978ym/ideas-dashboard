/**
 * Unified Channel Sync
 *
 * Lightweight sync that fetches ALL conversation types from Slack
 * (public_channel, private_channel, im, mpim) and upserts them
 * with proper names and conversation_type.
 *
 * Does NOT fetch message history — that's handled by backfill/dm-sync.
 */

import { prisma } from '@/lib/db';
import { decryptToken } from '@/lib/crypto/tokens';
import { batchResolveUserNames } from './client';

const SYNC_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface SyncResult {
  synced: number;
  errors: string[];
}

/**
 * Sync all conversation types for a workspace.
 * Uses user token (all types) with fallback to bot token (public/private only).
 */
export async function syncWorkspaceChannels(workspaceId: string): Promise<SyncResult> {
  const result: SyncResult = { synced: 0, errors: [] };

  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace || workspace.status !== 'active') {
    result.errors.push('Workspace not found or inactive');
    return result;
  }

  // Prefer user token (can access im/mpim), fall back to bot token
  const hasUserToken = !!workspace.encrypted_user_token;
  const hasBotToken = !!workspace.encrypted_bot_token;

  if (!hasUserToken && !hasBotToken) {
    result.errors.push('No token available');
    return result;
  }

  const token = hasUserToken
    ? decryptToken(workspace.encrypted_user_token!)
    : decryptToken(workspace.encrypted_bot_token!);

  // User token can list all types; bot token only public/private
  const types = hasUserToken
    ? 'public_channel,private_channel,im,mpim'
    : 'public_channel,private_channel';

  // Fetch all conversations with pagination
  const conversations: any[] = [];
  let cursor: string | undefined;

  do {
    const params: Record<string, string> = {
      types,
      exclude_archived: 'true',
      limit: '200',
    };
    if (cursor) params.cursor = cursor;

    const data = await slackFetch(token, 'conversations.list', params);

    if (!data.ok) {
      result.errors.push(`conversations.list failed: ${data.error}`);
      break;
    }

    conversations.push(...(data.channels || []));
    cursor = data.response_metadata?.next_cursor;
    if (cursor) await sleep(1200);
  } while (cursor);

  // Collect user IDs that need name resolution (for im and mpim)
  const userIdsToResolve = new Set<string>();
  for (const conv of conversations) {
    if (conv.is_im && conv.user) {
      userIdsToResolve.add(conv.user);
    }
  }

  // For mpim, we need to fetch members and resolve them
  const mpimMemberMap = new Map<string, string[]>();
  for (const conv of conversations) {
    if (conv.is_mpim) {
      try {
        const membersData = await slackFetch(token, 'conversations.members', {
          channel: conv.id,
          limit: '100',
        });
        if (membersData.ok && membersData.members) {
          mpimMemberMap.set(conv.id, membersData.members);
          membersData.members.forEach((uid: string) => userIdsToResolve.add(uid));
        }
        await sleep(500);
      } catch {
        // Fall back to conv.name if member fetch fails
      }
    }
  }

  // Batch resolve all user names
  const userNameMap = userIdsToResolve.size > 0
    ? await batchResolveUserNames(token, [...userIdsToResolve])
    : new Map<string, string>();

  // Get auth user info to exclude from mpim display names
  let authUserId: string | undefined;
  try {
    const authData = await slackFetch(token, 'auth.test', {});
    if (authData.ok) authUserId = authData.user_id;
  } catch {
    // Not critical
  }

  // Upsert all conversations
  for (const conv of conversations) {
    try {
      const convType = getConversationType(conv);
      const name = resolveConversationName(conv, mpimMemberMap, userNameMap, authUserId);
      const participants = getParticipants(conv, mpimMemberMap);

      await prisma.channel.upsert({
        where: {
          workspace_id_slack_channel_id: {
            workspace_id: workspaceId,
            slack_channel_id: conv.id,
          },
        },
        create: {
          workspace_id: workspaceId,
          slack_channel_id: conv.id,
          name,
          is_private: conv.is_private || conv.is_im || conv.is_mpim || false,
          is_monitored: true,
          conversation_type: convType,
          participants,
        },
        update: {
          name,
          is_private: conv.is_private || conv.is_im || conv.is_mpim || false,
          conversation_type: convType,
          participants,
        },
      });
      result.synced++;
    } catch (err: any) {
      result.errors.push(`${conv.id}: ${err.message}`);
    }
  }

  return result;
}

/**
 * Sync channels for all active workspaces (if stale).
 */
export async function syncAllWorkspacesIfStale(): Promise<void> {
  const workspaces = await prisma.workspace.findMany({
    where: { status: 'active' },
    select: { id: true },
  });

  for (const ws of workspaces) {
    // Check if any channel in this workspace is stale
    const latestChannel = await prisma.channel.findFirst({
      where: { workspace_id: ws.id },
      orderBy: { updated_at: 'desc' },
      select: { updated_at: true },
    });

    const isStale = !latestChannel ||
      Date.now() - latestChannel.updated_at.getTime() > SYNC_CACHE_TTL_MS;

    if (isStale) {
      await syncWorkspaceChannels(ws.id);
    }
  }
}

function getConversationType(conv: any): string {
  if (conv.is_im) return 'im';
  if (conv.is_mpim) return 'mpim';
  if (conv.is_private) return 'private_channel';
  return 'channel';
}

function resolveConversationName(
  conv: any,
  mpimMemberMap: Map<string, string[]>,
  userNameMap: Map<string, string>,
  authUserId?: string
): string {
  // Regular channels: use Slack name
  if (!conv.is_im && !conv.is_mpim) {
    return conv.name || conv.id;
  }

  // 1:1 DM: resolve user name
  if (conv.is_im && conv.user) {
    return userNameMap.get(conv.user) || `dm-${conv.user}`;
  }

  // Group DM (mpim): join member display names, excluding auth user
  if (conv.is_mpim) {
    const members = mpimMemberMap.get(conv.id);
    if (members && members.length > 0) {
      const names = members
        .filter((uid) => uid !== authUserId)
        .map((uid) => userNameMap.get(uid) || uid)
        .sort();
      if (names.length > 0) return names.join(', ');
    }
    // Fallback: conv.name without mpdm- prefix
    if (conv.name) {
      return conv.name
        .replace(/^mpdm-/, '')
        .replace(/-\d+$/, '')
        .split('--')
        .join(', ');
    }
  }

  return conv.name || `conversation-${conv.id.slice(-4)}`;
}

function getParticipants(conv: any, mpimMemberMap: Map<string, string[]>): any {
  if (conv.is_im && conv.user) return [conv.user];
  if (conv.is_mpim) return mpimMemberMap.get(conv.id) || conv.members || [];
  return null;
}

async function slackFetch(token: string, method: string, params: Record<string, string>): Promise<any> {
  const url = new URL(`https://slack.com/api/${method}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  return res.json();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
