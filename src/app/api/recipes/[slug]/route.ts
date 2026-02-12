/**
 * API Routes for Single Recipe Operations
 *
 * GET /api/recipes/[slug] - Get single recipe by slug
 * PUT /api/recipes/[slug] - Update custom recipe
 * DELETE /api/recipes/[slug] - Delete custom recipe (only non-builtin)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getBuiltinRecipe, validateRecipe, RecipeDefinition } from '@/lib/recipes/registry';

interface RouteContext {
  params: Promise<{
    slug: string;
  }>;
}

/**
 * GET /api/recipes/[slug]
 * Get a single recipe by slug (checks built-in first, then database)
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { slug } = await context.params;

    // Check built-in recipes first
    const builtinRecipe = getBuiltinRecipe(slug);
    if (builtinRecipe) {
      return NextResponse.json({
        success: true,
        recipe: builtinRecipe,
        is_builtin: true
      });
    }

    // Check database for custom recipe
    const customRecipe = await prisma.recipe.findUnique({
      where: { slug }
    });

    if (!customRecipe) {
      return NextResponse.json(
        {
          success: false,
          error: 'Recipe not found',
          slug
        },
        { status: 404 }
      );
    }

    // Convert to RecipeDefinition format
    const recipeDef: RecipeDefinition = {
      slug: customRecipe.slug,
      name: customRecipe.name,
      description: customRecipe.description || '',
      category: customRecipe.category as RecipeDefinition['category'],
      promptTemplate: customRecipe.prompt_template,
      variables: (customRecipe.variables as unknown as RecipeDefinition['variables']) || [],
      outputSchema: (customRecipe.output_schema as unknown as Record<string, unknown>) || {},
      version: customRecipe.version
    };

    return NextResponse.json({
      success: true,
      recipe: recipeDef,
      is_builtin: false,
      id: customRecipe.id,
      created_at: customRecipe.created_at,
      updated_at: customRecipe.updated_at
    });
  } catch (error) {
    console.error('Error fetching recipe:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch recipe',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/recipes/[slug]
 * Update a custom recipe (cannot update built-in recipes)
 */
export async function PUT(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { slug } = await context.params;
    const body = await request.json();

    // Check if it's a built-in recipe
    const builtinRecipe = getBuiltinRecipe(slug);
    if (builtinRecipe) {
      return NextResponse.json(
        {
          success: false,
          error: 'Cannot update built-in recipes',
          slug
        },
        { status: 403 }
      );
    }

    // Check if custom recipe exists
    const existingRecipe = await prisma.recipe.findUnique({
      where: { slug }
    });

    if (!existingRecipe) {
      return NextResponse.json(
        {
          success: false,
          error: 'Recipe not found',
          slug
        },
        { status: 404 }
      );
    }

    // Prepare update data
    const updateData: {
      name?: string;
      description?: string;
      category?: string;
      prompt_template?: string;
      variables?: object;
      output_schema?: object;
      version?: number;
    } = {};

    if (body.name) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.category) updateData.category = body.category;
    if (body.promptTemplate || body.prompt_template) {
      updateData.prompt_template = body.promptTemplate || body.prompt_template;
    }
    if (body.variables) updateData.variables = body.variables as object;
    if (body.outputSchema || body.output_schema) {
      updateData.output_schema = (body.outputSchema || body.output_schema) as object;
    }
    if (body.version) updateData.version = body.version;

    // Validate the updated recipe if we have enough data
    if (Object.keys(updateData).length > 0) {
      const recipeToValidate: Partial<RecipeDefinition> = {
        slug: existingRecipe.slug,
        name: updateData.name || existingRecipe.name,
        description: updateData.description ?? existingRecipe.description ?? '',
        category: (updateData.category || existingRecipe.category) as RecipeDefinition['category'],
        promptTemplate: updateData.prompt_template || existingRecipe.prompt_template,
        variables: (updateData.variables || existingRecipe.variables) as unknown as RecipeDefinition['variables'],
        outputSchema: (updateData.output_schema || existingRecipe.output_schema) as unknown as Record<string, unknown>,
        version: updateData.version || existingRecipe.version
      };

      const validation = validateRecipe(recipeToValidate);
      if (!validation.valid) {
        return NextResponse.json(
          {
            success: false,
            error: 'Recipe validation failed',
            errors: validation.errors
          },
          { status: 400 }
        );
      }
    }

    // Update recipe in database
    const updatedRecipe = await prisma.recipe.update({
      where: { slug },
      data: updateData
    });

    return NextResponse.json({
      success: true,
      recipe: {
        id: updatedRecipe.id,
        slug: updatedRecipe.slug,
        name: updatedRecipe.name,
        description: updatedRecipe.description,
        category: updatedRecipe.category,
        promptTemplate: updatedRecipe.prompt_template,
        variables: updatedRecipe.variables,
        outputSchema: updatedRecipe.output_schema,
        version: updatedRecipe.version,
        created_at: updatedRecipe.created_at,
        updated_at: updatedRecipe.updated_at
      }
    });
  } catch (error) {
    console.error('Error updating recipe:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update recipe',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/recipes/[slug]
 * Delete a custom recipe (cannot delete built-in recipes)
 */
export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { slug } = await context.params;

    // Check if it's a built-in recipe
    const builtinRecipe = getBuiltinRecipe(slug);
    if (builtinRecipe) {
      return NextResponse.json(
        {
          success: false,
          error: 'Cannot delete built-in recipes',
          slug
        },
        { status: 403 }
      );
    }

    // Check if custom recipe exists
    const existingRecipe = await prisma.recipe.findUnique({
      where: { slug }
    });

    if (!existingRecipe) {
      return NextResponse.json(
        {
          success: false,
          error: 'Recipe not found',
          slug
        },
        { status: 404 }
      );
    }

    // Delete recipe from database
    await prisma.recipe.delete({
      where: { slug }
    });

    return NextResponse.json({
      success: true,
      message: 'Recipe deleted successfully',
      slug
    });
  } catch (error) {
    console.error('Error deleting recipe:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to delete recipe',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
