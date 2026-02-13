/**
 * API Route for Prompt Generation
 *
 * POST /api/llm/generate-prompt
 * Generates a prompt from a recipe and variables
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getBuiltinRecipe, RecipeDefinition } from '@/lib/recipes/registry';
import { generatePrompt, SlackMessageForPrompt } from '@/lib/recipes/engine';
import { getProviders } from '@/lib/llm/providers';

/**
 * POST /api/llm/generate-prompt
 *
 * Body:
 * {
 *   recipeSlug: string,
 *   variables?: {
 *     messages?: string[], // Array of message IDs
 *     messageId?: string,  // Single message ID
 *     channelId?: string,
 *     workspaceId?: string,
 *     userInput?: string
 *   }
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { recipeSlug, variables = {} } = body;

    if (!recipeSlug) {
      return NextResponse.json(
        {
          success: false,
          error: 'Recipe slug is required'
        },
        { status: 400 }
      );
    }

    // Load recipe (built-in or custom)
    let recipe: RecipeDefinition | null = null;

    // Check built-in first
    const builtinRecipe = getBuiltinRecipe(recipeSlug);
    if (builtinRecipe) {
      recipe = builtinRecipe;
    } else {
      // Check database for custom recipe
      const customRecipe = await prisma.recipe.findUnique({
        where: { slug: recipeSlug }
      });

      if (customRecipe) {
        recipe = {
          slug: customRecipe.slug,
          name: customRecipe.name,
          description: customRecipe.description || '',
          category: customRecipe.category as RecipeDefinition['category'],
          promptTemplate: customRecipe.prompt_template,
          variables: (customRecipe.variables as unknown as RecipeDefinition['variables']) || [],
          outputSchema: (customRecipe.output_schema as unknown as Record<string, unknown>) || {},
          version: customRecipe.version
        };
      }
    }

    if (!recipe) {
      return NextResponse.json(
        {
          success: false,
          error: 'Recipe not found',
          slug: recipeSlug
        },
        { status: 404 }
      );
    }

    // Prepare variables for prompt generation
    const promptVariables: Record<string, unknown> = { ...variables };

    // Fetch messages from database if message IDs are provided
    if (variables.messages && Array.isArray(variables.messages)) {
      const messageIds = variables.messages;
      const messages = await prisma.slackMessage.findMany({
        where: {
          id: { in: messageIds }
        },
        orderBy: { created_at: 'asc' }
      });

      // Convert to format expected by prompt generator
      const formattedMessages: SlackMessageForPrompt[] = messages.map(msg => ({
        user_name: msg.user_name || 'Unknown User',
        text: msg.text,
        ts: msg.slack_ts,
        thread_ts: msg.thread_ts || undefined
      }));

      promptVariables.messages = formattedMessages;
    }

    // Fetch single message if messageId is provided
    if (variables.messageId) {
      const message = await prisma.slackMessage.findUnique({
        where: { id: variables.messageId }
      });

      if (message) {
        const formattedMessage: SlackMessageForPrompt = {
          user_name: message.user_name || 'Unknown User',
          text: message.text,
          ts: message.slack_ts,
          thread_ts: message.thread_ts || undefined
        };

        promptVariables.message = formattedMessage;

        // Fetch thread context if this is part of a thread
        if (message.thread_ts) {
          const threadMessages = await prisma.slackMessage.findMany({
            where: {
              slack_channel_id: message.slack_channel_id,
              workspace_id: message.workspace_id,
              thread_ts: message.thread_ts,
              slack_ts: { not: message.slack_ts } // Exclude the current message
            },
            orderBy: { created_at: 'asc' },
            take: 10 // Limit thread context to 10 messages
          });

          const formattedThread: SlackMessageForPrompt[] = threadMessages.map(msg => ({
            user_name: msg.user_name || 'Unknown User',
            text: msg.text,
            ts: msg.slack_ts,
            thread_ts: msg.thread_ts || undefined
          }));

          promptVariables.thread = formattedThread;
        }
      }
    }

    // Fetch channel context if channelId is provided
    if (variables.channelId) {
      const channel = await prisma.channel.findUnique({
        where: { id: variables.channelId },
        include: { workspace: true }
      });

      if (channel) {
        promptVariables.channel_context = {
          name: channel.name,
          workspace: channel.workspace.name
        };
      }
    }

    // Generate the prompt
    let prompt: string;
    try {
      prompt = generatePrompt(recipe, promptVariables);
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to generate prompt',
          message: error instanceof Error ? error.message : 'Unknown error'
        },
        { status: 400 }
      );
    }

    // Get provider URLs
    const providers = await getProviders();
    const providerUrls: Record<string, string> = {};
    for (const provider of providers) {
      providerUrls[provider.id] = provider.uiUrl;
    }

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

    // Create an AnalysisRun record in pending state
    let analysisRunId: string | undefined;
    if (variables.workspaceId) {
      const analysisRun = await prisma.analysisRun.create({
        data: {
          recipe_id: dbRecipe.id,
          workspace_id: variables.workspaceId,
          channel_id: variables.channelId || null,
          llm_provider: 'claude',
          status: 'pending',
          prompt_text: prompt
        }
      });
      analysisRunId = analysisRun.id;
    }

    return NextResponse.json({
      success: true,
      prompt,
      recipeSlug,
      recipeName: recipe.name,
      provider_urls: providerUrls,
      analysis_run_id: analysisRunId,
      instructions: [
        'Copy the prompt above',
        'Open your preferred LLM provider (Claude, ChatGPT, or Gemini)',
        'Paste the prompt and wait for the response',
        'Copy the entire JSON response',
        'Use the /api/llm/parse-result endpoint to parse and save the results'
      ]
    });
  } catch (error) {
    console.error('Error generating prompt:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to generate prompt',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
