import { NextRequest, NextResponse } from 'next/server';
import { getProviders, saveGeminiModel, saveGeminiApiKey } from '@/lib/llm/providers';

/** GET /api/settings/llm - List providers with status */
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

/** POST /api/settings/llm - Update Gemini settings (model and/or API key) */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { model_id, api_key } = body;

    if (api_key) {
      await saveGeminiApiKey(api_key);
    }

    if (model_id) {
      await saveGeminiModel(model_id);
    }

    if (!model_id && !api_key) {
      return NextResponse.json({ error: 'model_id or api_key is required' }, { status: 400 });
    }

    const providers = await getProviders();

    return NextResponse.json({
      success: true,
      message: api_key ? 'APIキーを保存しました' : 'Geminiモデルを更新しました',
      providers,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to save setting', message: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
