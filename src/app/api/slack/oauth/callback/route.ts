/**
 * Slack OAuth Callback
 *
 * GET /api/slack/oauth/callback
 * Handles the OAuth callback from Slack after user authorization.
 * Exchanges code for tokens and stores workspace in database.
 */

import { NextRequest, NextResponse } from 'next/server';
import { WebClient } from '@slack/web-api';
import { prisma } from '@/lib/db';
import { encryptToken } from '@/lib/crypto/tokens';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const searchParams = req.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  // Check if user denied authorization
  if (error) {
    console.error('[Slack OAuth] User denied authorization:', error);
    return NextResponse.redirect(
      new URL(`/workspaces?error=access_denied`, req.nextUrl.origin)
    );
  }

  // Validate required parameters
  if (!code || !state) {
    console.error('[Slack OAuth] Missing code or state parameter');
    return NextResponse.json(
      { error: 'Missing required parameters' },
      { status: 400 }
    );
  }

  // Verify state parameter to prevent CSRF
  const storedState = req.cookies.get('slack_oauth_state')?.value;

  if (storedState && storedState !== state) {
    console.error('[Slack OAuth] State mismatch - possible CSRF attack');
    return NextResponse.json(
      { error: 'Invalid state parameter' },
      { status: 400 }
    );
  }

  if (!storedState) {
    console.warn('[Slack OAuth] State cookie not found - cookie may not persist in serverless environment');
  }

  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('[Slack OAuth] Client credentials not configured');
    return NextResponse.json(
      { error: 'OAuth credentials not configured' },
      { status: 500 }
    );
  }

  // Get redirect URI (must match the one used in authorization request)
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VERCEL_URL ||
    `${req.nextUrl.protocol}//${req.nextUrl.host}`;

  const redirectUri = `${baseUrl}/api/slack/oauth/callback`;

  try {
    // Exchange code for access token
    const client = new WebClient();

    const response = await client.oauth.v2.access({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    });

    if (!response.ok) {
      throw new Error(`OAuth exchange failed: ${response.error}`);
    }

    console.log('[Slack OAuth] Successfully exchanged code for tokens');

    // Extract workspace and token information
    const teamId = response.team?.id;
    const teamName = response.team?.name;
    const botToken = response.access_token;

    // User token and user ID are optional
    const userToken = response.authed_user?.access_token;
    const userId = response.authed_user?.id;

    // Extract scopes
    const botScopes = response.scope ? response.scope.split(',') : [];
    const userScopes = response.authed_user?.scope ? response.authed_user.scope.split(',') : [];

    if (!teamId || !teamName || !botToken) {
      throw new Error('Missing required fields in OAuth response');
    }

    // Encrypt tokens before storing
    const encryptedBotToken = encryptToken(botToken);
    const encryptedUserToken = userToken ? encryptToken(userToken) : null;

    // Check if workspace already exists
    const existingWorkspace = await prisma.workspace.findUnique({
      where: { team_id: teamId },
    });

    let workspace;

    if (existingWorkspace) {
      // Update existing workspace with new tokens
      workspace = await prisma.workspace.update({
        where: { id: existingWorkspace.id },
        data: {
          name: teamName,
          encrypted_bot_token: encryptedBotToken,
          encrypted_user_token: encryptedUserToken,
          scopes: botScopes,
          authed_user_id: userId || undefined,
          user_scopes: userScopes,
          bot_scopes: botScopes,
          installed_by: userId || undefined,
        },
      });

      console.log(`[Slack OAuth] Updated workspace ${teamId}: ${teamName}`);
    } else {
      // Create new workspace
      workspace = await prisma.workspace.create({
        data: {
          team_id: teamId,
          name: teamName,
          encrypted_bot_token: encryptedBotToken,
          encrypted_user_token: encryptedUserToken,
          scopes: botScopes,
          authed_user_id: userId || undefined,
          user_scopes: userScopes,
          bot_scopes: botScopes,
          installed_by: userId || undefined,
        },
      });

      console.log(`[Slack OAuth] Created workspace ${teamId}: ${teamName}`);
    }

    // Clear the state cookie
    const redirectResponse = NextResponse.redirect(
      new URL(`/workspaces?success=true`, req.nextUrl.origin)
    );

    redirectResponse.cookies.delete('slack_oauth_state');

    return redirectResponse;
  } catch (error) {
    console.error('[Slack OAuth] Error during OAuth flow:', error);

    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';

    return NextResponse.redirect(
      new URL(
        `/workspaces?error=oauth_failed&message=${encodeURIComponent(errorMessage)}`,
        req.nextUrl.origin
      )
    );
  }
}
