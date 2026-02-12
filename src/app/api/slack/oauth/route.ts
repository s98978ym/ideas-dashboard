/**
 * Slack OAuth Initiation
 *
 * GET /api/slack/oauth
 * Redirects to Slack's OAuth authorization page.
 */

import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

// Slack OAuth scopes
const BOT_SCOPES = [
  'channels:history',
  'channels:read',
  'chat:write',
  'groups:history',
  'groups:read',
  'im:history',
  'im:read',
  'mpim:history',
  'mpim:read',
  'users:read',
  'team:read',
].join(',');

const USER_SCOPES = [
  'chat:write',
  'im:read',
  'im:history',
  'mpim:read',
  'mpim:history',
  'channels:read',
  'channels:history',
  'groups:read',
  'groups:history',
  'users:read',
].join(',');

export async function GET(req: NextRequest): Promise<NextResponse> {
  const clientId = process.env.SLACK_CLIENT_ID;

  if (!clientId) {
    return NextResponse.json(
      { error: 'SLACK_CLIENT_ID not configured' },
      { status: 500 }
    );
  }

  // Generate random state parameter for CSRF protection
  const state = uuidv4();

  // Get redirect URI from environment or construct from request
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VERCEL_URL ||
    `${req.nextUrl.protocol}//${req.nextUrl.host}`;

  const redirectUri = `${baseUrl}/api/slack/oauth/callback`;

  // Build Slack OAuth URL
  const authUrl = new URL('https://slack.com/oauth/v2/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('scope', BOT_SCOPES);
  authUrl.searchParams.set('user_scope', USER_SCOPES);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);

  // Store state in cookie for verification in callback
  const response = NextResponse.redirect(authUrl.toString());

  response.cookies.set('slack_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
    path: '/',
  });

  console.log(`[Slack OAuth] Redirecting to Slack authorization`);

  return response;
}
