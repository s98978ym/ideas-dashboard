/**
 * LLM Provider Configuration
 *
 * Manages LLM provider settings and future API integration.
 * Currently supports manual bridge (copy/paste), with API execution
 * planned for future implementation.
 */

export interface LLMProvider {
  id: 'claude' | 'chatgpt' | 'gemini';
  name: string;
  uiUrl: string; // URL to open the LLM's web UI
  apiConfigured: boolean; // check if API key is in env
  supportsApi: boolean;
}

/**
 * Get all available LLM providers with their configuration status
 */
export function getProviders(): LLMProvider[] {
  return [
    {
      id: 'claude',
      name: 'Claude (Anthropic)',
      uiUrl: 'https://claude.ai/new',
      apiConfigured: !!process.env.ANTHROPIC_API_KEY,
      supportsApi: true
    },
    {
      id: 'chatgpt',
      name: 'ChatGPT (OpenAI)',
      uiUrl: 'https://chat.openai.com/',
      apiConfigured: !!process.env.OPENAI_API_KEY,
      supportsApi: true
    },
    {
      id: 'gemini',
      name: 'Gemini (Google)',
      uiUrl: 'https://gemini.google.com/',
      apiConfigured: !!process.env.GOOGLE_AI_API_KEY,
      supportsApi: true
    }
  ];
}

/**
 * Get a specific LLM provider by ID
 */
export function getProvider(id: string): LLMProvider | undefined {
  const providers = getProviders();
  return providers.find(provider => provider.id === id);
}

/**
 * Check if a provider has API key configured
 */
export function isProviderConfigured(providerId: string): boolean {
  const provider = getProvider(providerId);
  return provider?.apiConfigured || false;
}

/**
 * Get the environment variable name for a provider's API key
 */
export function getProviderEnvVar(providerId: string): string | undefined {
  const envVarMap: Record<string, string> = {
    claude: 'ANTHROPIC_API_KEY',
    chatgpt: 'OPENAI_API_KEY',
    gemini: 'GOOGLE_AI_API_KEY'
  };

  return envVarMap[providerId];
}

/**
 * Execute prompt via LLM API
 *
 * STUB: This is a placeholder for future API integration.
 * Currently throws an error indicating the feature is not yet implemented.
 *
 * @param providerId - The LLM provider to use ('claude', 'chatgpt', or 'gemini')
 * @param prompt - The prompt to send to the LLM
 * @returns Promise<string> - The LLM's response
 * @throws Error - Always throws as API execution is not yet implemented
 */
export async function executeViaApi(
  providerId: string,
  prompt: string
): Promise<string> {
  const provider = getProvider(providerId);

  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }

  // Check if API key is configured
  if (!provider.apiConfigured) {
    const envVar = getProviderEnvVar(providerId);
    throw new Error(
      `API execution not yet implemented. Please configure ${envVar} environment variable to enable API access for ${provider.name}.`
    );
  }

  // Even if configured, API execution is not yet implemented
  throw new Error(
    `API execution coming soon. For now, please use the manual bridge: copy the prompt to ${provider.name} UI and paste back the result.`
  );
}

/**
 * Get instructions for manual bridge workflow
 */
export function getManualBridgeInstructions(providerId: string): {
  provider: string;
  url: string;
  steps: string[];
} {
  const provider = getProvider(providerId);

  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }

  return {
    provider: provider.name,
    url: provider.uiUrl,
    steps: [
      `Open ${provider.name} in a new tab: ${provider.uiUrl}`,
      'Copy the generated prompt from this application',
      `Paste the prompt into ${provider.name}`,
      'Wait for the LLM to generate a response',
      'Copy the entire JSON response from the LLM',
      'Paste the response back into this application to parse and save the results'
    ]
  };
}

/**
 * Validate provider ID
 */
export function isValidProviderId(id: string): id is 'claude' | 'chatgpt' | 'gemini' {
  return ['claude', 'chatgpt', 'gemini'].includes(id);
}

/**
 * Get default provider based on configuration
 * Prefers Claude if configured, otherwise returns first configured provider
 */
export function getDefaultProvider(): LLMProvider {
  const providers = getProviders();

  // Prefer Claude if configured
  const claude = providers.find(p => p.id === 'claude');
  if (claude?.apiConfigured) {
    return claude;
  }

  // Return first configured provider
  const configured = providers.find(p => p.apiConfigured);
  if (configured) {
    return configured;
  }

  // Default to Claude even if not configured (for manual bridge)
  return providers[0];
}

/**
 * Get provider statistics
 */
export function getProviderStats(): {
  total: number;
  configured: number;
  unconfigured: number;
} {
  const providers = getProviders();

  return {
    total: providers.length,
    configured: providers.filter(p => p.apiConfigured).length,
    unconfigured: providers.filter(p => !p.apiConfigured).length
  };
}
