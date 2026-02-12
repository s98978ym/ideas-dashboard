import { NextRequest, NextResponse } from 'next/server';
import { getProviders, saveGeminiModel } from '@/lib/llm/providers';

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

/** POST /api/settings/llm - Update Gemini model preference */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { model_id } = body;

    if (!model_id) {
      return NextResponse.json({ error: 'model_id is required' }, { status: 400 });
    }

    await saveGeminiModel(model_id);
    const providers = await getProviders();

    return NextResponse.json({
      success: true,
      message: 'Gemini model updated',
      providers,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to save setting', message: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
