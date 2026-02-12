/**
 * API Route for Result Parsing
 *
 * POST /api/llm/parse-result
 * Parses LLM response, validates against schema, and saves results
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getBuiltinRecipe, RecipeDefinition } from '@/lib/recipes/registry';
import { parseResult } from '@/lib/recipes/engine';

/**
 * POST /api/llm/parse-result
 *
 * Body:
 * {
 *   recipeSlug: string,
 *   rawResult: string,
 *   analysisRunId?: string,
 *   workspaceId?: string,
 *   channelId?: string
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { recipeSlug, rawResult, analysisRunId, workspaceId, channelId } = body;

    if (!recipeSlug) {
      return NextResponse.json(
        {
          success: false,
          error: 'Recipe slug is required'
        },
        { status: 400 }
      );
    }

    if (!rawResult) {
      return NextResponse.json(
        {
          success: false,
          error: 'Raw result is required'
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

    // Parse and validate the result
    const parseResultData = parseResult(recipe, rawResult);

    if (!parseResultData.success) {
      // Update AnalysisRun with error if ID provided
      if (analysisRunId) {
        await prisma.analysisRun.update({
          where: { id: analysisRunId },
          data: {
            status: 'error',
            raw_result: rawResult,
            error: parseResultData.errors?.join('; ')
          }
        });
      }

      return NextResponse.json(
        {
          success: false,
          errors: parseResultData.errors,
          raw_result: rawResult
        },
        { status: 400 }
      );
    }

    const parsedData = parseResultData.data;

    // Handle recipe-specific actions
    let createdTodos: unknown[] = [];
    let createdDrafts: unknown[] = [];

    // TODO Extraction: Create TodoItem records
    if (recipeSlug === 'todo_extraction' && parsedData && typeof parsedData === 'object') {
      const todoData = parsedData as { todos?: Array<{
        title: string;
        description: string;
        assignee?: string | null;
        due_date?: string | null;
        priority: string;
        source_message_ts: string;
      }> };

      if (todoData.todos && Array.isArray(todoData.todos)) {
        for (const todo of todoData.todos) {
          // Find source message by timestamp
          let sourceMessageId: string | null = null;
          if (todo.source_message_ts && workspaceId) {
            const sourceMessage = await prisma.slackMessage.findFirst({
              where: {
                workspace_id: workspaceId,
                slack_ts: todo.source_message_ts
              }
            });
            if (sourceMessage) {
              sourceMessageId = sourceMessage.id;
            }
          }

          const createdTodo = await prisma.todoItem.create({
            data: {
              title: todo.title,
              description: todo.description,
              status: 'open',
              source_message_id: sourceMessageId,
              analysis_run_id: analysisRunId || null,
              assigned_to: todo.assignee || null,
              due_date: todo.due_date ? new Date(todo.due_date) : null
            }
          });

          createdTodos.push(createdTodo);
        }
      }
    }

    // Reply Draft: Create Draft records
    if (recipeSlug === 'reply_draft' && parsedData && typeof parsedData === 'object') {
      const draftData = parsedData as {
        reply?: string;
        tone?: string;
        alternative_replies?: string[];
      };

      if (draftData.reply && workspaceId) {
        // Create primary draft
        const createdDraft = await prisma.draft.create({
          data: {
            workspace_id: workspaceId,
            channel_id: channelId || '',
            text: draftData.reply,
            status: 'draft',
            analysis_run_id: analysisRunId || null
          }
        });

        createdDrafts.push(createdDraft);

        // Create alternative drafts
        if (draftData.alternative_replies && Array.isArray(draftData.alternative_replies)) {
          for (const altReply of draftData.alternative_replies) {
            const altDraft = await prisma.draft.create({
              data: {
                workspace_id: workspaceId,
                channel_id: channelId || '',
                text: altReply,
                status: 'draft',
                analysis_run_id: analysisRunId || null
              }
            });

            createdDrafts.push(altDraft);
          }
        }
      }
    }

    // Update or create AnalysisRun record
    let analysisRun;
    if (analysisRunId) {
      // Update existing run
      analysisRun = await prisma.analysisRun.update({
        where: { id: analysisRunId },
        data: {
          status: 'parsed',
          raw_result: rawResult,
          parsed_result: parsedData as object
        }
      });
    } else if (workspaceId) {
      // Create new run if we have workspace context
      // First, ensure recipe exists in DB or get/create it
      let recipeId = recipe.slug;
      const dbRecipe = await prisma.recipe.findUnique({
        where: { slug: recipe.slug }
      });

      if (!dbRecipe && builtinRecipe) {
        // Create built-in recipe in DB for reference
        const created = await prisma.recipe.create({
          data: {
            slug: builtinRecipe.slug,
            name: builtinRecipe.name,
            description: builtinRecipe.description,
            category: builtinRecipe.category,
            prompt_template: builtinRecipe.promptTemplate,
            variables: builtinRecipe.variables as unknown as object,
            output_schema: builtinRecipe.outputSchema as unknown as object,
            version: builtinRecipe.version,
            is_builtin: true
          }
        });
        recipeId = created.id;
      } else if (dbRecipe) {
        recipeId = dbRecipe.id;
      }

      analysisRun = await prisma.analysisRun.create({
        data: {
          recipe_id: recipeId,
          workspace_id: workspaceId,
          channel_id: channelId || null,
          llm_provider: 'claude', // Default, could be passed in body
          status: 'parsed',
          prompt_text: 'Direct parse (no prompt generated)',
          raw_result: rawResult,
          parsed_result: parsedData as object
        }
      });
    }

    return NextResponse.json({
      success: true,
      data: parsedData,
      analysis_run_id: analysisRun?.id,
      created_todos_count: createdTodos.length,
      created_drafts_count: createdDrafts.length,
      created_todos: createdTodos,
      created_drafts: createdDrafts,
      recipe: {
        slug: recipe.slug,
        name: recipe.name,
        category: recipe.category
      }
    });
  } catch (error) {
    console.error('Error parsing result:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to parse result',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
