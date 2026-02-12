/**
 * LLM Provider Configuration and API Execution
 *
 * Supports Claude (Anthropic), ChatGPT (OpenAI), and Gemini (Google).
 * API keys are stored encrypted in the database via LlmSetting model.
 */

import { prisma } from '@/lib/db';
import { encryptToken, decryptToken } from '@/lib/crypto/tokens';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

export interface LLMProvider {
  id: 'claude' | 'chatgpt' | 'gemini';
  name: string;
  uiUrl: string;
  apiConfigured: boolean;
  supportsApi: boolean;
  defaultModel: string;
}

const PROVIDER_DEFAULTS: Record<string, { name: string; uiUrl: string; defaultModel: string }> = {
  claude: {
    name: 'Claude (Anthropic)',
    uiUrl: 'https://claude.ai/new',
    defaultModel: 'claude-sonnet-4-5-20250929',
  },
  chatgpt: {
    name: 'ChatGPT (OpenAI)',
    uiUrl: 'https://chat.openai.com/',
    defaultModel: 'gpt-4o',
  },
  gemini: {
    name: 'Gemini (Google)',
    uiUrl: 'https://gemini.google.com/',
    defaultModel: 'gemini-2.0-flash',
  },
};

/**
 * Get all available LLM providers with their configuration status
 */
export async function getProviders(): Promise<LLMProvider[]> {
  const settings = await prisma.llmSetting.findMany();
  const settingsMap = new Map(settings.map((s) => [s.provider, s]));

  return Object.entries(PROVIDER_DEFAULTS).map(([id, defaults]) => {
    const setting = settingsMap.get(id);
    return {
      id: id as LLMProvider['id'],
      name: defaults.name,
      uiUrl: defaults.uiUrl,
      apiConfigured: !!(setting?.encrypted_api_key && setting.is_enabled),
      supportsApi: true,
      defaultModel: setting?.model_id || defaults.defaultModel,
    };
  });
}

/**
 * Get a specific LLM provider by ID
 */
export async function getProvider(id: string): Promise<LLMProvider | undefined> {
  const providers = await getProviders();
  return providers.find((p) => p.id === id);
}

/**
 * Save API key for a provider (encrypted)
 */
export async function saveApiKey(
  providerId: string,
  apiKey: string,
  modelId?: string
): Promise<void> {
  const encrypted = encryptToken(apiKey);

  await prisma.llmSetting.upsert({
    where: { provider: providerId },
    create: {
      provider: providerId,
      encrypted_api_key: encrypted,
      model_id: modelId || PROVIDER_DEFAULTS[providerId]?.defaultModel || null,
      is_enabled: true,
    },
    update: {
      encrypted_api_key: encrypted,
      ...(modelId !== undefined ? { model_id: modelId } : {}),
      is_enabled: true,
    },
  });
}

/**
 * Remove API key for a provider
 */
export async function removeApiKey(providerId: string): Promise<void> {
  await prisma.llmSetting.deleteMany({ where: { provider: providerId } });
}

/**
 * Get decrypted API key for a provider
 */
async function getApiKey(providerId: string): Promise<string> {
  const setting = await prisma.llmSetting.findUnique({
    where: { provider: providerId },
  });

  if (!setting || !setting.encrypted_api_key || !setting.is_enabled) {
    throw new Error(`API key not configured for ${providerId}. Please add it in Settings.`);
  }

  return decryptToken(setting.encrypted_api_key);
}

/**
 * Get model ID for a provider
 */
async function getModelId(providerId: string): Promise<string> {
  const setting = await prisma.llmSetting.findUnique({
    where: { provider: providerId },
  });
  return setting?.model_id || PROVIDER_DEFAULTS[providerId]?.defaultModel || '';
}

/**
 * Execute prompt via LLM API
 */
export async function executeViaApi(
  providerId: string,
  prompt: string
): Promise<string> {
  const apiKey = await getApiKey(providerId);
  const modelId = await getModelId(providerId);

  switch (providerId) {
    case 'claude':
      return executeWithClaude(apiKey, modelId, prompt);
    case 'chatgpt':
      return executeWithChatGPT(apiKey, modelId, prompt);
    case 'gemini':
      return executeWithGemini(apiKey, modelId, prompt);
    default:
      throw new Error(`Unknown provider: ${providerId}`);
  }
}

async function executeWithClaude(apiKey: string, model: string, prompt: string): Promise<string> {
  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = message.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude');
  }
  return textBlock.text;
}

async function executeWithChatGPT(apiKey: string, model: string, prompt: string): Promise<string> {
  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 4096,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('No response from ChatGPT');
  }
  return content;
}

async function executeWithGemini(apiKey: string, model: string, prompt: string): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const genModel = genAI.getGenerativeModel({ model });
  const result = await genModel.generateContent(prompt);
  const text = result.response.text();

  if (!text) {
    throw new Error('No response from Gemini');
  }
  return text;
}

/**
 * Get instructions for manual bridge workflow
 */
export function getManualBridgeInstructions(providerId: string): {
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
      `Open ${defaults.name} in a new tab: ${defaults.uiUrl}`,
      'Copy the generated prompt from this application',
      `Paste the prompt into ${defaults.name}`,
      'Wait for the LLM to generate a response',
      'Copy the entire JSON response from the LLM',
      'Paste the response back into this application to parse and save the results',
    ],
  };
}

/**
 * Validate provider ID
 */
export function isValidProviderId(id: string): id is 'claude' | 'chatgpt' | 'gemini' {
  return ['claude', 'chatgpt', 'gemini'].includes(id);
}
