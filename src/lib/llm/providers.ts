/**
 * LLM Provider Configuration
 *
 * - Gemini: Auto-execution via Google OAuth token (user's login session)
 * - Claude / ChatGPT: Manual via Web UI (copy/paste prompt)
 */

import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/options';

export interface LLMProvider {
  id: 'claude' | 'chatgpt' | 'gemini';
  name: string;
  uiUrl: string;
  supportsAutoExecute: boolean;
  autoExecuteReady: boolean;
  defaultModel: string;
}

const PROVIDER_DEFAULTS: Record<
  string,
  { name: string; uiUrl: string; defaultModel: string; supportsAutoExecute: boolean }
> = {
  gemini: {
    name: 'Gemini (Google)',
    uiUrl: 'https://gemini.google.com/',
    defaultModel: 'gemini-2.0-flash',
    supportsAutoExecute: true,
  },
  claude: {
    name: 'Claude (Anthropic)',
    uiUrl: 'https://claude.ai/new',
    defaultModel: '',
    supportsAutoExecute: false,
  },
  chatgpt: {
    name: 'ChatGPT (OpenAI)',
    uiUrl: 'https://chat.openai.com/',
    defaultModel: '',
    supportsAutoExecute: false,
  },
};

/**
 * Get all available LLM providers with their status.
 * Gemini is "ready" if the user has a Google OAuth session.
 */
export async function getProviders(): Promise<LLMProvider[]> {
  let googleConnected = false;

  try {
    const session = await getServerSession(authOptions);
    googleConnected = !!(session?.user);
  } catch {
    // Outside request context or no session
  }

  // Check for stored model preference
  const geminiSetting = await prisma.llmSetting
    .findUnique({ where: { provider: 'gemini' } })
    .catch(() => null);

  return Object.entries(PROVIDER_DEFAULTS).map(([id, defaults]) => ({
    id: id as LLMProvider['id'],
    name: defaults.name,
    uiUrl: defaults.uiUrl,
    supportsAutoExecute: defaults.supportsAutoExecute,
    autoExecuteReady: id === 'gemini' ? googleConnected : false,
    defaultModel:
      id === 'gemini' ? geminiSetting?.model_id || defaults.defaultModel : defaults.defaultModel,
  }));
}

/**
 * Get a specific provider
 */
export async function getProvider(id: string): Promise<LLMProvider | undefined> {
  const providers = await getProviders();
  return providers.find((p) => p.id === id);
}

/**
 * Save Gemini model preference
 */
export async function saveGeminiModel(modelId: string): Promise<void> {
  await prisma.llmSetting.upsert({
    where: { provider: 'gemini' },
    create: {
      provider: 'gemini',
      encrypted_api_key: '__oauth__',
      model_id: modelId,
      is_enabled: true,
    },
    update: { model_id: modelId },
  });
}

/**
 * Refresh Google access token if expired.
 * Returns a fresh access token.
 */
async function refreshGoogleToken(userId: string): Promise<string> {
  const account = await prisma.account.findFirst({
    where: { userId, provider: 'google' },
  });

  if (!account) {
    throw new Error('Google account not linked. Please log in again.');
  }

  // Check if token is still valid (5 min buffer)
  const now = Math.floor(Date.now() / 1000);
  if (account.access_token && account.expires_at && account.expires_at > now + 300) {
    return account.access_token;
  }

  // Refresh the token
  if (!account.refresh_token) {
    throw new Error('No refresh token available. Please log in again with Google.');
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: 'refresh_token',
      refresh_token: account.refresh_token,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to refresh Google token: ${err}`);
  }

  const tokens = await response.json();

  // Update stored token
  await prisma.account.update({
    where: { id: account.id },
    data: {
      access_token: tokens.access_token,
      expires_at: tokens.expires_in
        ? Math.floor(Date.now() / 1000) + tokens.expires_in
        : undefined,
    },
  });

  return tokens.access_token;
}

/**
 * Execute prompt via Gemini using Google OAuth token.
 * Calls the Generative Language REST API directly with Bearer token.
 */
export async function executeWithGeminiOAuth(
  userId: string,
  prompt: string,
  model?: string
): Promise<string> {
  const accessToken = await refreshGoogleToken(userId);

  const geminiModel = model || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error('No text response from Gemini');
  }

  return text;
}

/**
 * Get Web UI instructions for manual providers
 */
export function getWebUiInstructions(providerId: string): {
  provider: string;
  url: string;
  steps: string[];
} {
  const defaults = PROVIDER_DEFAULTS[providerId];
  if (!defaults) throw new Error(`Unknown provider: ${providerId}`);

  return {
    provider: defaults.name,
    url: defaults.uiUrl,
    steps: [
      'プロンプトをコピー',
      `${defaults.name}を新しいタブで開く: ${defaults.uiUrl}`,
      'プロンプトを貼り付けて実行',
      'JSON形式のレスポンスをコピー',
      'このアプリに戻って結果を貼り付け',
    ],
  };
}

/**
 * Validate provider ID
 */
export function isValidProviderId(id: string): id is 'claude' | 'chatgpt' | 'gemini' {
  return ['claude', 'chatgpt', 'gemini'].includes(id);
}
