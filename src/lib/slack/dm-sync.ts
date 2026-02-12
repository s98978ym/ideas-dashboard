import { prisma } from '@/lib/db';
import { decryptToken } from '@/lib/crypto/tokens';
import { batchResolveUserNames } from './client';

interface DMSyncResult {
  conversationsFound: number;
  conversationsProcessed: number;
  messagesAdded: number;
  errors: string[];
}

/**
 * Sync all DMs for a workspace using user token.
 * Uses conversations.list(types=im,mpim) then conversations.history for each.
 * Idempotent: skips already-saved messages via unique constraint.
 */
export async function syncWorkspaceDMs(workspaceId: string, options?: { force?: boolean }): Promise<DMSyncResult> {
  const result: DMSyncResult = { conversationsFound: 0, conversationsProcessed: 0, messagesAdded: 0, errors: [] };

  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace || !workspace.encrypted_user_token) {
    result.errors.push('Workspace not found or no user token');
    return result;
  }

  const userToken = decryptToken(workspace.encrypted_user_token);

  // Step 1: List all DM conversations
  let cursor: string | undefined;
  const dmConversations: any[] = [];

  do {
    const listRes = await slackFetch(userToken, 'conversations.list', {
      types: 'im,mpim',
      limit: '200',
      ...(cursor ? { cursor } : {}),
    });

    if (!listRes.ok) {
      result.errors.push(`conversations.list failed: ${listRes.error}`);
      break;
    }

    dmConversations.push(...(listRes.channels || []));
    cursor = listRes.response_metadata?.next_cursor;
    result.conversationsFound = dmConversations.length;

    if (cursor) await sleep(1200);
  } while (cursor);

  // Step 2: For each DM, upsert Channel and sync history
  for (const conv of dmConversations) {
    try {
      // Upsert channel record
      const channel = await prisma.channel.upsert({
        where: {
          workspace_id_slack_channel_id: {
            workspace_id: workspaceId,
            slack_channel_id: conv.id,
          },
        },
        create: {
          workspace_id: workspaceId,
          slack_channel_id: conv.id,
          name: conv.name || getDMName(conv),
          is_private: true,
          is_monitored: true,
          conversation_type: conv.is_mpim ? 'mpim' : 'im',
          participants: conv.members || (conv.user ? [conv.user] : []),
        },
        update: {
          name: conv.name || getDMName(conv),
          conversation_type: conv.is_mpim ? 'mpim' : 'im',
          participants: conv.members || (conv.user ? [conv.user] : []),
        },
      });

      // Get messages since last sync (or all if force)
      const oldest = options?.force ? undefined : (channel.last_backfill_ts || undefined);
      let msgCursor: string | undefined;
      let latestTs: string | undefined;

      // Collect all messages first, then batch-resolve user names
      const allMessages: any[] = [];

      do {
        const histRes = await slackFetch(userToken, 'conversations.history', {
          channel: conv.id,
          limit: '100',
          ...(oldest ? { oldest } : {}),
          ...(msgCursor ? { cursor: msgCursor } : {}),
        });

        if (!histRes.ok) {
          result.errors.push(`history for ${conv.id}: ${histRes.error}`);
          break;
        }

        allMessages.push(...(histRes.messages || []));
        msgCursor = histRes.response_metadata?.next_cursor;
        if (msgCursor) await sleep(1200);
      } while (msgCursor);

      // Batch resolve user names for this conversation
      const userIds = allMessages.map((m) => m.user).filter(Boolean);
      const userNameMap = await batchResolveUserNames(userToken, userIds);

      for (const msg of allMessages) {
        if (!msg.ts) continue;

        try {
          const userName = msg.user ? (userNameMap.get(msg.user) || null) : null;
          const createdAt = new Date(parseFloat(msg.ts) * 1000);

          await prisma.slackMessage.upsert({
            where: {
              workspace_id_slack_channel_id_slack_ts: {
                workspace_id: workspaceId,
                slack_channel_id: conv.id,
                slack_ts: msg.ts,
              },
            },
            create: {
              workspace_id: workspaceId,
              channel_id: channel.id,
              slack_channel_id: conv.id,
              slack_ts: msg.ts,
              thread_ts: msg.thread_ts || null,
              is_thread_reply: !!(msg.thread_ts && msg.thread_ts !== msg.ts),
              user_id: msg.user || null,
              user_name: userName,
              text: msg.text || '',
              raw_json: msg,
              created_at: createdAt,
            },
            update: {
              user_name: userName,
              text: msg.text || '',
              raw_json: msg,
              created_at: createdAt,
            },
          });
          result.messagesAdded++;
          if (!latestTs || msg.ts > latestTs) latestTs = msg.ts;
        } catch (e: any) {
          result.errors.push(`save msg ${msg.ts}: ${e.message}`);
        }
      }

      // Update last sync position
      if (latestTs) {
        await prisma.channel.update({
          where: { id: channel.id },
          data: { last_backfill_ts: latestTs },
        });
      }

      result.conversationsProcessed++;
      await sleep(500); // Rate limit between conversations
    } catch (err: any) {
      result.errors.push(`${conv.id}: ${err.message}`);
    }
  }

  // Update workspace last sync time
  await prisma.workspace.update({
    where: { id: workspaceId },
    data: { last_dm_sync_at: new Date() },
  });

  return result;
}

function getDMName(conv: any): string {
  if (conv.is_mpim) return conv.name || `group-dm-${conv.id.slice(-4)}`;
  return `dm-${conv.user || conv.id.slice(-4)}`;
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
  return new Promise(r => setTimeout(r, ms));
}
