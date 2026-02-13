/**
 * POST /api/llm/execute
 *
 * Auto-execution for Gemini via Google OAuth.
 * Claude/ChatGPT are manual (Web UI) — use generate-prompt instead.
 *
 * Body: {
 *   recipe_slug: string,
 *   workspace_id?: string,
 *   channel_id?: string,
 *   variables?: Record<string, any>,
 *   model?: string
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/options';
import { prisma } from '@/lib/db';
import { getBuiltinRecipe, RecipeDefinition } from '@/lib/recipes/registry';
import { generatePrompt, SlackMessageForPrompt, parseResult } from '@/lib/recipes/engine';
import { executeWithGeminiOAuth } from '@/lib/llm/providers';

export async function POST(request: NextRequest) {
  try {
    // Require authenticated session
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const userId = (session.user as any).id;
    if (!userId) {
      return NextResponse.json({ error: 'User ID not found in session' }, { status: 401 });
    }

    const body = await request.json();
    const { recipe_slug, workspace_id, channel_id, variables = {}, model } = body;

    if (!recipe_slug) {
      return NextResponse.json({ error: 'recipe_slug is required' }, { status: 400 });
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

    // Build prompt variables
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

    // Ensure recipe exists in database (upsert built-in recipes on first use)
    const dbRecipe = await prisma.recipe.upsert({
      where: { slug: recipe.slug },
      create: {
        slug: recipe.slug,
        name: recipe.name,
        description: recipe.description,
        category: recipe.category,
        prompt_template: recipe.promptTemplate,
        output_schema: recipe.outputSchema as object,
        variables: recipe.variables as unknown as object,
        version: recipe.version,
        is_builtin: true,
      },
      update: {},
    });

    // Create AnalysisRun record
    let analysisRunId: string | undefined;
    if (workspace_id) {
      const run = await prisma.analysisRun.create({
        data: {
          recipe_id: dbRecipe.id,
          workspace_id,
          channel_id: channel_id || null,
          llm_provider: 'gemini',
          status: 'pending',
          prompt_text: prompt,
        },
      });
      analysisRunId = run.id;
    }

    // Execute via Gemini OAuth
    let rawResult: string;
    try {
      rawResult = await executeWithGeminiOAuth(userId, prompt, model);
    } catch (err) {
      if (analysisRunId) {
        await prisma.analysisRun.update({
          where: { id: analysisRunId },
          data: { status: 'error', error: err instanceof Error ? err.message : 'Gemini call failed' },
        });
      }
      return NextResponse.json(
        { error: 'Gemini execution failed', message: err instanceof Error ? err.message : 'Unknown' },
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
          parsed_result: parsed.success ? (parsed.data as object) : undefined,
          error: parsed.success ? undefined : parsed.errors?.join('; '),
        },
      });
    }

    return NextResponse.json({
      success: parsed.success,
      raw_result: rawResult,
      parsed_data: parsed.data,
      errors: parsed.errors,
      analysis_run_id: analysisRunId,
      provider: 'gemini',
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
