/**
 * LLM Provider Configuration
 *
 * - Gemini: Auto-execution via API key
 * - Claude / ChatGPT: Manual via Web UI (copy/paste prompt)
 */

import { prisma } from '@/lib/db';
import { encryptToken, decryptToken } from '@/lib/crypto/tokens';

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
 * Gemini is "ready" if an API key has been configured.
 */
export async function getProviders(): Promise<LLMProvider[]> {
  const geminiSetting = await prisma.llmSetting
    .findUnique({ where: { provider: 'gemini' } })
    .catch(() => null);

  const hasApiKey =
    !!geminiSetting?.encrypted_api_key && geminiSetting.encrypted_api_key !== '__oauth__';

  return Object.entries(PROVIDER_DEFAULTS).map(([id, defaults]) => ({
    id: id as LLMProvider['id'],
    name: defaults.name,
    uiUrl: defaults.uiUrl,
    supportsAutoExecute: defaults.supportsAutoExecute,
    autoExecuteReady: id === 'gemini' ? hasApiKey : false,
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
      encrypted_api_key: '',
      model_id: modelId,
      is_enabled: true,
    },
    update: { model_id: modelId },
  });
}

/**
 * Save Gemini API key (encrypted)
 */
export async function saveGeminiApiKey(apiKey: string): Promise<void> {
  const encrypted = encryptToken(apiKey);
  await prisma.llmSetting.upsert({
    where: { provider: 'gemini' },
    create: {
      provider: 'gemini',
      encrypted_api_key: encrypted,
      model_id: 'gemini-2.0-flash',
      is_enabled: true,
    },
    update: { encrypted_api_key: encrypted },
  });
}

/**
 * Get decrypted Gemini API key
 */
export async function getGeminiApiKey(): Promise<string | null> {
  const setting = await prisma.llmSetting.findUnique({ where: { provider: 'gemini' } });
  if (!setting?.encrypted_api_key || setting.encrypted_api_key === '__oauth__') {
    return null;
  }
  try {
    return decryptToken(setting.encrypted_api_key);
  } catch {
    return null;
  }
}

/**
 * Execute prompt via Gemini using API key.
 */
export async function executeWithGemini(
  prompt: string,
  model?: string
): Promise<string> {
  const apiKey = await getGeminiApiKey();
  if (!apiKey) {
    throw new Error('Gemini APIキーが設定されていません。設定ページでAPIキーを登録してください。');
  }

  const geminiModel = model || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
