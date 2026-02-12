import { prisma } from '@/lib/db';
import { getWorkspaceClient } from './client';

export interface SlackEventPayload {
  token?: string;
  team_id: string;
  api_app_id?: string;
  event: SlackEvent;
  type: string;
  event_id: string;
  event_time: number;
  authorizations?: Array<{
    enterprise_id?: string;
    team_id: string;
    user_id: string;
    is_bot: boolean;
  }>;
}

export interface SlackEvent {
  type: string;
  event_ts: string;
  user?: string;
  ts?: string;
  channel?: string;
  channel_type?: string;
  text?: string;
  thread_ts?: string;
  parent_user_id?: string;
  subtype?: string;
  message?: any;
  previous_message?: any;
  bot_id?: string;
  deleted_ts?: string;
  reaction?: string;
  files?: Array<{
    id: string;
    name: string;
    mimetype: string;
    url_private: string;
    permalink: string;
  }>;
  [key: string]: any;
}

export async function processSlackEvent(
  payload: SlackEventPayload
): Promise<void> {
  const { event, team_id, event_id } = payload;

  console.log(`[Slack] Processing event ${event_id} of type ${event.type}`);

  const workspace = await prisma.workspace.findUnique({
    where: { team_id },
  });

  if (!workspace) {
    console.error(`[Slack] Workspace not found for team_id: ${team_id}`);
    return;
  }

  // Deduplicate using event_id on SlackMessage
  if (event.type === 'message' || event.type === 'app_mention') {
    const existingByEventId = await prisma.slackMessage.findFirst({
      where: { event_id },
    });
    if (existingByEventId) {
      console.log(`[Slack] Event ${event_id} already processed, skipping`);
      return;
    }
  }

  switch (event.type) {
    case 'message':
      await handleMessageEvent(workspace.id, event, event_id);
      break;
    case 'app_mention':
      await handleAppMention(workspace.id, event, event_id);
      break;
    default:
      console.log(`[Slack] Unhandled event type: ${event.type}`);
  }
}

async function handleMessageEvent(
  workspaceId: string,
  event: SlackEvent,
  eventId: string
): Promise<void> {
  if (event.bot_id) {
    console.log('[Slack] Skipping bot message');
    return;
  }

  if (event.subtype) {
    switch (event.subtype) {
      case 'message_changed':
        await handleMessageChanged(workspaceId, event);
        return;
      case 'message_deleted':
        await handleMessageDeleted(workspaceId, event);
        return;
      case 'file_share':
        break;
      case 'bot_message':
        return;
      default:
        console.log(`[Slack] Skipping message subtype: ${event.subtype}`);
        return;
    }
  }

  if (!event.channel || !event.ts) {
    console.log('[Slack] Message missing required fields, skipping');
    return;
  }

  const channel = await findOrCreateChannel(workspaceId, event.channel, event.channel_type);
  if (!channel) return;

  // Deduplicate by unique constraint
  const existing = await prisma.slackMessage.findUnique({
    where: {
      workspace_id_slack_channel_id_slack_ts: {
        workspace_id: workspaceId,
        slack_channel_id: event.channel,
        slack_ts: event.ts,
      },
    },
  });

  if (existing) {
    console.log(`[Slack] Message ${event.ts} already exists, skipping`);
    return;
  }

  const message = await prisma.slackMessage.create({
    data: {
      workspace_id: workspaceId,
      channel_id: channel.id,
      slack_channel_id: event.channel,
      slack_ts: event.ts,
      thread_ts: event.thread_ts || null,
      is_thread_reply: !!(event.thread_ts && event.thread_ts !== event.ts),
      user_id: event.user || null,
      user_name: null, // Could fetch from users.info
      text: event.text || '',
      raw_json: event as any,
      event_id: eventId,
    },
  });

  console.log(`[Slack] Saved message ${message.id}`);
  await checkForInboxItem(workspaceId, channel, message.id, event);
}

async function handleMessageChanged(
  workspaceId: string,
  event: SlackEvent
): Promise<void> {
  if (!event.message || !event.channel) return;

  await prisma.slackMessage.updateMany({
    where: {
      workspace_id: workspaceId,
      slack_channel_id: event.channel,
      slack_ts: event.message.ts,
    },
    data: {
      text: event.message.text || '',
      raw_json: event.message as any,
    },
  });
}

async function handleMessageDeleted(
  workspaceId: string,
  event: SlackEvent
): Promise<void> {
  if (!event.deleted_ts || !event.channel) return;

  // Hard delete since we don't have a deleted_at field
  await prisma.slackMessage.deleteMany({
    where: {
      workspace_id: workspaceId,
      slack_channel_id: event.channel,
      slack_ts: event.deleted_ts,
    },
  });
}

async function handleAppMention(
  workspaceId: string,
  event: SlackEvent,
  eventId: string
): Promise<void> {
  if (!event.channel || !event.ts) return;

  // Save message first
  await handleMessageEvent(workspaceId, event, eventId);

  const message = await prisma.slackMessage.findFirst({
    where: {
      workspace_id: workspaceId,
      slack_channel_id: event.channel!,
      slack_ts: event.ts!,
    },
  });

  if (!message) return;

  await prisma.inboxItem.create({
    data: {
      message_id: message.id,
      user_id: event.user || 'system',
      reason: 'mention',
    },
  });
}

async function findOrCreateChannel(
  workspaceId: string,
  slackChannelId: string,
  channelType?: string
): Promise<any> {
  let channel = await prisma.channel.findFirst({
    where: {
      workspace_id: workspaceId,
      slack_channel_id: slackChannelId,
    },
  });

  if (!channel) {
    try {
      const client = await getWorkspaceClient(workspaceId);
      const info = await client.conversations.info({ channel: slackChannelId });

      if (info.ok && info.channel) {
        channel = await prisma.channel.create({
          data: {
            workspace_id: workspaceId,
            slack_channel_id: slackChannelId,
            name: (info.channel as any).name || slackChannelId,
            is_private: (info.channel as any).is_private || false,
          },
        });
      }
    } catch (error) {
      console.error('[Slack] Failed to fetch channel info:', error);
      channel = await prisma.channel.create({
        data: {
          workspace_id: workspaceId,
          slack_channel_id: slackChannelId,
          name: slackChannelId,
          is_private: channelType === 'im' || channelType === 'mpim',
        },
      });
    }
  }

  return channel;
}

async function checkForInboxItem(
  workspaceId: string,
  channel: any,
  messageId: string,
  event: SlackEvent
): Promise<void> {
  let shouldCreate = false;
  let reason: string = 'related';

  if (channel.is_private && channel.name?.startsWith('D')) {
    shouldCreate = true;
    reason = 'keyword'; // DM
  }

  if (event.thread_ts && event.thread_ts !== event.ts) {
    shouldCreate = true;
    reason = 'related';
  }

  const keywords = ['urgent', 'asap', 'help needed', 'bug', 'error'];
  if (keywords.some((kw) => event.text?.toLowerCase().includes(kw))) {
    shouldCreate = true;
    reason = 'keyword';
  }

  if (shouldCreate) {
    await prisma.inboxItem.create({
      data: {
        message_id: messageId,
        user_id: event.user || 'system',
        reason,
      },
    });
  }
}
