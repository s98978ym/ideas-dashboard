/**
 * Slack Web API Client Factory
 *
 * Provides utilities for creating Slack WebClient instances
 * with rate-limiting awareness and workspace token management.
 */

import { WebClient, ErrorCode, LogLevel } from '@slack/web-api';
import { prisma } from '@/lib/db';
import { decryptToken } from '@/lib/crypto/tokens';

/**
 * Create a Slack WebClient instance
 *
 * @param token - Slack bot or user token
 * @returns Configured WebClient instance
 */
export function getSlackClient(token: string): WebClient {
  return new WebClient(token, {
    logLevel: process.env.NODE_ENV === 'development' ? LogLevel.DEBUG : LogLevel.INFO,
  });
}

/**
 * Get Slack client for a specific workspace
 *
 * Loads workspace from database, decrypts bot token, and returns client.
 * Throws error if workspace not found or token is invalid.
 *
 * @param workspaceId - Workspace ID (Prisma ID or Slack team_id)
 * @returns Configured WebClient for the workspace
 */
export async function getWorkspaceClient(
  workspaceId: string
): Promise<WebClient> {
  // Try to find workspace by ID first, then by team_id
  const workspace = await prisma.workspace.findFirst({
    where: {
      OR: [{ id: workspaceId }, { team_id: workspaceId }],
    },
  });

  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  if (!workspace.encrypted_bot_token) {
    throw new Error(`Workspace ${workspaceId} has no bot token configured`);
  }

  // Decrypt the bot token
  const token = decryptToken(workspace.encrypted_bot_token);

  return getSlackClient(token);
}

/**
 * Rate-limit aware wrapper for Slack API calls
 *
 * Catches rate_limited errors and logs retry-after information.
 * The @slack/web-api package handles retries automatically with
 * exponential backoff, but we log for monitoring purposes.
 *
 * @param client - WebClient instance
 * @param method - API method name (e.g., 'chat.postMessage')
 * @param params - Method parameters
 * @returns API response
 */
export async function callWithRateLimit<T>(
  client: WebClient,
  method: string,
  params: any = {}
): Promise<T> {
  try {
    // The WebClient methods are accessed dynamically
    const apiMethod = (client as any)[method.replace('.', '_')];

    if (!apiMethod) {
      throw new Error(`Unknown Slack API method: ${method}`);
    }

    const response = await apiMethod.call(client, params);
    return response as T;
  } catch (error: any) {
    // Check if this is a rate limit error
    if (error.code === ErrorCode.RateLimitedError) {
      const retryAfter = error.retryAfter || 'unknown';
      console.warn(
        `[Slack] Rate limited on ${method}. Retry after: ${retryAfter}s`
      );

      // The SDK will automatically retry, but we log it
      // You could also implement custom backoff logic here
    }

    // Check for other common errors
    if (error.code === ErrorCode.PlatformError) {
      console.error(`[Slack] Platform error on ${method}:`, error.data);
    }

    if (error.code === ErrorCode.RequestError) {
      console.error(`[Slack] Request error on ${method}:`, error.message);
    }

    // Re-throw for caller to handle
    throw error;
  }
}

/**
 * Test workspace connection
 *
 * Verifies that the bot token is valid and returns basic workspace info.
 *
 * @param workspaceId - Workspace ID
 * @returns Object with team info or null if connection fails
 */
export async function testWorkspaceConnection(workspaceId: string): Promise<{
  ok: boolean;
  team?: string;
  user?: string;
  error?: string;
}> {
  try {
    const client = await getWorkspaceClient(workspaceId);

    const authTest = await callWithRateLimit<any>(client, 'auth.test', {});

    if (!authTest.ok) {
      return {
        ok: false,
        error: authTest.error || 'Unknown error',
      };
    }

    return {
      ok: true,
      team: authTest.team,
      user: authTest.user,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Refresh workspace information
 *
 * Updates workspace name and other metadata from Slack API.
 *
 * @param workspaceId - Workspace ID
 */
export async function refreshWorkspaceInfo(
  workspaceId: string
): Promise<void> {
  const client = await getWorkspaceClient(workspaceId);

  const teamInfo = await callWithRateLimit<any>(client, 'team.info', {});

  if (teamInfo.ok && teamInfo.team) {
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        name: teamInfo.team.name,
        // You could add more fields here: domain, email_domain, icon, etc.
      },
    });
  }
}

/**
 * Batch API call helper
 *
 * Makes multiple API calls with automatic rate limiting between calls.
 * Useful for pagination or bulk operations.
 *
 * @param client - WebClient instance
 * @param calls - Array of {method, params} objects
 * @param delayMs - Delay between calls in milliseconds
 * @returns Array of responses
 */
export async function batchApiCalls<T>(
  client: WebClient,
  calls: Array<{ method: string; params?: any }>,
  delayMs = 1000
): Promise<T[]> {
  const results: T[] = [];

  for (let i = 0; i < calls.length; i++) {
    const { method, params } = calls[i];

    try {
      const result = await callWithRateLimit<T>(client, method, params);
      results.push(result);
    } catch (error) {
      console.error(`[Slack] Batch call failed for ${method}:`, error);
      throw error;
    }

    // Add delay between calls (except for the last one)
    if (i < calls.length - 1 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return results;
}
