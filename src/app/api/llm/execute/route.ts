/**
 * POST /api/llm/execute
 *
 * One-click auto-execution: generates prompt, calls LLM API, parses result.
 *
 * Body: {
 *   recipe_slug: string,
 *   llm_provider: 'claude' | 'chatgpt' | 'gemini',
 *   workspace_id?: string,
 *   channel_id?: string,
 *   time_range?: string,
 *   variables?: Record<string, any>
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getBuiltinRecipe, RecipeDefinition } from '@/lib/recipes/registry';
import { generatePrompt, SlackMessageForPrompt, parseResult } from '@/lib/recipes/engine';
import { executeViaApi, getProvider } from '@/lib/llm/providers';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { recipe_slug, llm_provider = 'claude', workspace_id, channel_id, variables = {} } = body;

    if (!recipe_slug) {
      return NextResponse.json({ error: 'recipe_slug is required' }, { status: 400 });
    }

    // Check provider is configured
    const provider = await getProvider(llm_provider);
    if (!provider?.apiConfigured) {
      return NextResponse.json(
        { error: `${llm_provider} is not configured. Add your API key in Settings.` },
        { status: 400 }
      );
    }

    // Load recipe
    let recipe: RecipeDefinition | null = getBuiltinRecipe(recipe_slug) || null;
    if (!recipe) {
      const custom = await prisma.recipe.findUnique({ where: { slug: recipe_slug } });
      if (custom) {
        recipe = {
          slug: custom.slug,
          name: custom.name,
          description: custom.description || '',
          category: custom.category as RecipeDefinition['category'],
          promptTemplate: custom.prompt_template,
          variables: (custom.variables as unknown as RecipeDefinition['variables']) || [],
          outputSchema: (custom.output_schema as unknown as Record<string, unknown>) || {},
          version: custom.version,
        };
      }
    }

    if (!recipe) {
      return NextResponse.json({ error: 'Recipe not found' }, { status: 404 });
    }

    // Build prompt variables (fetch messages from DB if needed)
    const promptVars: Record<string, unknown> = { ...variables };

    if (channel_id) {
      const messages = await prisma.slackMessage.findMany({
        where: { channel_id },
        orderBy: { created_at: 'asc' },
        take: 50,
      });

      const formatted: SlackMessageForPrompt[] = messages.map((m) => ({
        user_name: m.user_name || 'Unknown User',
        text: m.text,
        ts: m.slack_ts,
        thread_ts: m.thread_ts || undefined,
      }));
      promptVars.messages = formatted;

      const channel = await prisma.channel.findUnique({
        where: { id: channel_id },
        include: { workspace: true },
      });
      if (channel) {
        promptVars.channel_context = { name: channel.name, workspace: channel.workspace.name };
      }
    }

    // Generate prompt
    const prompt = generatePrompt(recipe, promptVars);

    // Create AnalysisRun record
    let analysisRunId: string | undefined;
    if (workspace_id) {
      const run = await prisma.analysisRun.create({
        data: {
          recipe_id: recipe.slug,
          workspace_id,
          channel_id: channel_id || null,
          llm_provider,
          status: 'pending',
          prompt_text: prompt,
        },
      });
      analysisRunId = run.id;
    }

    // Execute via API
    let rawResult: string;
    try {
      rawResult = await executeViaApi(llm_provider, prompt);
    } catch (err) {
      if (analysisRunId) {
        await prisma.analysisRun.update({
          where: { id: analysisRunId },
          data: { status: 'error', error: err instanceof Error ? err.message : 'API call failed' },
        });
      }
      return NextResponse.json(
        { error: 'LLM API call failed', message: err instanceof Error ? err.message : 'Unknown' },
        { status: 502 }
      );
    }

    // Parse result
    const parsed = parseResult(recipe, rawResult);

    if (analysisRunId) {
      await prisma.analysisRun.update({
        where: { id: analysisRunId },
        data: {
          status: parsed.success ? 'parsed' : 'error',
          raw_result: rawResult,
          parsed_result: parsed.success ? (parsed.data as object) : null,
          error: parsed.success ? null : parsed.errors?.join('; '),
        },
      });
    }

    return NextResponse.json({
      success: parsed.success,
      raw_result: rawResult,
      parsed_data: parsed.data,
      errors: parsed.errors,
      analysis_run_id: analysisRunId,
      provider: llm_provider,
      recipe: { slug: recipe.slug, name: recipe.name },
    });
  } catch (error) {
    console.error('Error in LLM execute:', error);
    return NextResponse.json(
      { error: 'Execution failed', message: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
