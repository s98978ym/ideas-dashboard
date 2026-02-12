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
 * Resolve Slack user IDs to display names
 *
 * Fetches user profiles from Slack and returns a map of user_id -> display_name.
 * Uses in-memory cache to avoid redundant API calls within the same process.
 *
 * @param client - WebClient instance
 * @param userIds - Array of Slack user IDs to resolve
 * @returns Map of user_id to display name
 */
const userNameCache = new Map<string, string>();

export async function resolveUserNames(
  client: WebClient,
  userIds: string[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const toFetch: string[] = [];

  for (const uid of userIds) {
    if (!uid) continue;
    const cached = userNameCache.get(uid);
    if (cached) {
      result.set(uid, cached);
    } else if (!toFetch.includes(uid)) {
      toFetch.push(uid);
    }
  }

  for (const uid of toFetch) {
    try {
      const info = await client.users.info({ user: uid });
      if (info.ok && info.user) {
        const profile = (info.user as any).profile || {};
        const name =
          profile.display_name ||
          profile.real_name ||
          (info.user as any).real_name ||
          (info.user as any).name ||
          uid;
        userNameCache.set(uid, name);
        result.set(uid, name);
      }
    } catch (error) {
      console.warn(`[Slack] Failed to fetch user info for ${uid}:`, error);
      result.set(uid, uid);
    }
    // Small delay between user lookups to respect rate limits
    await new Promise((r) => setTimeout(r, 200));
  }

  return result;
}

/**
 * Resolve a single Slack user ID to a display name using a raw token
 * (for use without a WebClient instance, e.g., in dm-sync)
 */
export async function resolveUserNameByToken(
  token: string,
  userId: string
): Promise<string | null> {
  const cached = userNameCache.get(userId);
  if (cached) return cached;

  try {
    const url = new URL('https://slack.com/api/users.info');
    url.searchParams.set('user', userId);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.ok && data.user) {
      const profile = data.user.profile || {};
      const name =
        profile.display_name ||
        profile.real_name ||
        data.user.real_name ||
        data.user.name ||
        userId;
      userNameCache.set(userId, name);
      return name;
    }
  } catch (error) {
    console.warn(`[Slack] Failed to fetch user info for ${userId}:`, error);
  }
  return null;
}

/**
 * Batch resolve user names by token (for dm-sync)
 * Collects unique IDs and resolves them all, returning a map.
 */
export async function batchResolveUserNames(
  token: string,
  userIds: string[]
): Promise<Map<string, string>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  const result = new Map<string, string>();

  for (const uid of unique) {
    const name = await resolveUserNameByToken(token, uid);
    if (name) result.set(uid, name);
    await new Promise((r) => setTimeout(r, 200));
  }

  return result;
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
