import { NextRequest, NextResponse } from 'next/server';
import { getProviders, saveApiKey, removeApiKey } from '@/lib/llm/providers';

/** GET /api/settings/llm - List providers with config status */
export async function GET() {
  try {
    const providers = await getProviders();
    return NextResponse.json({ providers });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch LLM settings', message: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}

/** POST /api/settings/llm - Save or remove API key */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { provider, api_key, model_id, action } = body;

    if (!provider || !['claude', 'chatgpt', 'gemini'].includes(provider)) {
      return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
    }

    if (action === 'remove') {
      await removeApiKey(provider);
      return NextResponse.json({ success: true, message: `Removed ${provider} API key` });
    }

    if (!api_key) {
      return NextResponse.json({ error: 'API key is required' }, { status: 400 });
    }

    await saveApiKey(provider, api_key, model_id);
    const providers = await getProviders();

    return NextResponse.json({
      success: true,
      message: `${provider} API key saved`,
      providers,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to save LLM setting', message: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
