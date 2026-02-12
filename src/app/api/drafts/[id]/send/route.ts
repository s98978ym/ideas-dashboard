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
 *   method: 'bot' | 'user_token' | 'copy'
 * }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: draftId } = await params;
    const body = await request.json();
    const { method } = body;

    if (!method || !['bot', 'user_token', 'copy'].includes(method)) {
      return NextResponse.json(
        { error: 'method is required and must be bot, user_token, or copy' },
        { status: 400 }
      );
    }

    // Fetch draft with workspace data
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

    // Get channel Slack ID (we need the slack_channel_id, not our internal ID)
    const channel = await prisma.channel.findUnique({
      where: { id: draft.channel_id },
      select: { slack_channel_id: true },
    });

    if (!channel) {
      return NextResponse.json(
        { error: 'Channel not found' },
        { status: 404 }
      );
    }

    let slackTs: string | undefined;
    let sentVia = method;

    // Handle different send methods
    if (method === 'copy') {
      // Just mark as copied, don't actually send
      await prisma.draft.update({
        where: { id: draftId },
        data: {
          status: 'copied',
          sent_via: 'copy',
        },
      });

      return NextResponse.json({
        success: true,
        method: 'copy',
        text: draft.text,
        message: 'Draft marked as copied. Text returned for manual posting.',
      });
    } else if (method === 'bot') {
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
        return NextResponse.json(
          {
            error: 'Failed to send message via Slack bot',
            message:
              slackError instanceof Error
                ? slackError.message
                : 'Unknown error',
          },
          { status: 502 }
        );
      }
    } else if (method === 'user_token') {
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
        return NextResponse.json(
          {
            error: 'Failed to send message via user token',
            message:
              slackError instanceof Error
                ? slackError.message
                : 'Unknown error',
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
