/**
 * Send Draft API
 *
 * POST /api/drafts/[id]/send - Send a draft via specified method
 *
 * Methods:
 * - bot: Send via workspace bot token (chat.postMessage)
 * - user_token: Send via workspace user token (requires user OAuth)
 * - copy: Just mark as copied, return the text
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { decryptToken } from '@/lib/crypto/tokens';

/**
 * Send message to Slack via bot token
 */
async function sendViaBot(
  botToken: string,
  channelId: string,
  text: string,
  threadTs?: string | null
): Promise<{ ok: boolean; ts?: string; error?: string }> {
  const payload: any = {
    channel: channelId,
    text: text,
  };

  if (threadTs) {
    payload.thread_ts = threadTs;
  }

  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Slack API HTTP error: ${response.statusText}`);
  }

  const data = await response.json();
  return data;
}

/**
 * POST /api/drafts/[id]/send
 * Send a draft
 *
 * Body: {
 *   send_mode: 'bot' | 'user' | 'copy'  (or legacy 'method' field)
 * }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: draftId } = await params;
    const body = await request.json();

    // Accept both send_mode (new) and method (legacy) for backward compatibility
    const sendMode = body.send_mode || body.method;

    // Normalize user_token to user
    const normalizedSendMode = sendMode === 'user_token' ? 'user' : sendMode;

    if (!normalizedSendMode || !['bot', 'user', 'copy'].includes(normalizedSendMode)) {
      return NextResponse.json(
        { error: 'send_mode is required and must be bot, user, or copy' },
        { status: 400 }
      );
    }

    // Fetch draft with workspace and channel data
    const draft = await prisma.draft.findUnique({
      where: { id: draftId },
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
            team_id: true,
            encrypted_bot_token: true,
            encrypted_user_token: true,
            status: true,
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

    if (draft.status === 'sent') {
      return NextResponse.json(
        { error: 'Draft has already been sent' },
        { status: 400 }
      );
    }

    if (draft.workspace.status !== 'active') {
      return NextResponse.json(
        { error: 'Workspace is not active' },
        { status: 403 }
      );
    }

    // Get channel Slack ID and conversation type (we need the slack_channel_id, not our internal ID)
    const channel = await prisma.channel.findUnique({
      where: { id: draft.channel_id },
      select: { slack_channel_id: true, conversation_type: true },
    });

    if (!channel) {
      return NextResponse.json(
        { error: 'Channel not found' },
        { status: 404 }
      );
    }

    // Check if bot can post to this conversation
    if (normalizedSendMode === 'bot' && channel.conversation_type === 'im') {
      return NextResponse.json({
        error: 'Bot cannot send messages to 1:1 DMs',
        message: 'Slack does not allow bots to post in direct messages between users. Use "user" mode (posts as you) or "copy" mode instead.',
        alternatives: ['user', 'copy'],
      }, { status: 400 });
    }

    let slackTs: string | undefined;
    let sentVia = normalizedSendMode;

    // Handle different send methods
    if (normalizedSendMode === 'copy') {
      // Just mark as copied, don't actually send
      await prisma.draft.update({
        where: { id: draftId },
        data: {
          status: 'copied',
          sent_via: 'copy',
          send_mode: 'copy',
          last_send_error: null,
        },
      });

      return NextResponse.json({
        success: true,
        method: 'copy',
        text: draft.text,
        message: 'Draft marked as copied. Text returned for manual posting.',
      });
    } else if (normalizedSendMode === 'bot') {
      // Send via bot token
      if (!draft.workspace.encrypted_bot_token) {
        return NextResponse.json(
          { error: 'Workspace has no bot token configured' },
          { status: 400 }
        );
      }

      try {
        const botToken = decryptToken(draft.workspace.encrypted_bot_token);
        const result = await sendViaBot(
          botToken,
          channel.slack_channel_id,
          draft.text,
          draft.thread_ts
        );

        if (!result.ok) {
          throw new Error(result.error || 'Unknown Slack API error');
        }

        slackTs = result.ts;
      } catch (slackError) {
        console.error('Error sending via Slack bot:', slackError);
        const errorMessage = slackError instanceof Error ? slackError.message : 'Unknown error';

        // Save error to draft
        await prisma.draft.update({
          where: { id: draftId },
          data: { last_send_error: errorMessage },
        });

        return NextResponse.json(
          {
            error: 'Failed to send message via Slack bot',
            message: errorMessage,
          },
          { status: 502 }
        );
      }
    } else if (normalizedSendMode === 'user') {
      // Send via user token
      if (!draft.workspace.encrypted_user_token) {
        return NextResponse.json(
          {
            error: 'Workspace has no user token configured',
            message:
              'User token is required for this method. Use bot method or copy instead.',
          },
          { status: 400 }
        );
      }

      try {
        const userToken = decryptToken(draft.workspace.encrypted_user_token);
        const result = await sendViaBot(
          userToken,
          channel.slack_channel_id,
          draft.text,
          draft.thread_ts
        );

        if (!result.ok) {
          throw new Error(result.error || 'Unknown Slack API error');
        }

        slackTs = result.ts;
      } catch (slackError) {
        console.error('Error sending via Slack user token:', slackError);
        const errorMessage = slackError instanceof Error ? slackError.message : 'Unknown error';

        // Save error to draft
        await prisma.draft.update({
          where: { id: draftId },
          data: { last_send_error: errorMessage },
        });

        return NextResponse.json(
          {
            error: 'Failed to send message via user token',
            message: errorMessage,
          },
          { status: 502 }
        );
      }
    }

    // Update draft status
    const updatedDraft = await prisma.draft.update({
      where: { id: draftId },
      data: {
        status: 'sent',
        sent_via: sentVia,
        send_mode: normalizedSendMode,
        last_send_error: null,
      },
      include: {
        workspace: {
          select: {
            name: true,
            team_id: true,
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      draft: updatedDraft,
      slack_ts: slackTs,
      method: sentVia,
    });
  } catch (error) {
    console.error('Error sending draft:', error);
    return NextResponse.json(
      {
        error: 'Failed to send draft',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
