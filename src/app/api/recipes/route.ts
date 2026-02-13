/**
 * API Routes for Recipe Management
 *
 * GET /api/recipes - List all recipes (built-in + custom from DB)
 * POST /api/recipes - Create custom recipe
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { BUILTIN_RECIPES, validateRecipe, RecipeDefinition } from '@/lib/recipes/registry';

/**
 * GET /api/recipes
 * List all recipes (built-in + custom from database)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const includeBuiltin = searchParams.get('include_builtin') !== 'false'; // Default true

    // Get custom recipes from database
    const customRecipes = await prisma.recipe.findMany({
      where: category ? { category } : undefined,
      orderBy: { created_at: 'desc' }
    });

    // Convert database recipes to RecipeDefinition format
    const customRecipeDefs = customRecipes.map(recipe => ({
      slug: recipe.slug,
      name: recipe.name,
      description: recipe.description || '',
      category: recipe.category as RecipeDefinition['category'],
      promptTemplate: recipe.prompt_template,
      variables: (recipe.variables as unknown as RecipeDefinition['variables']) || [],
      outputSchema: (recipe.output_schema as unknown as Record<string, unknown>) || {},
      version: recipe.version,
      is_active: true,
    }));

    // Combine with built-in recipes if requested
    let allRecipes = [...customRecipeDefs];

    if (includeBuiltin) {
      const builtinToInclude = (category
        ? BUILTIN_RECIPES.filter(r => r.category === category)
        : BUILTIN_RECIPES
      ).map(r => ({ ...r, is_active: true }));

      allRecipes = [...builtinToInclude, ...customRecipeDefs];
    }

    return NextResponse.json({
      success: true,
      recipes: allRecipes,
      count: allRecipes.length,
      builtin_count: includeBuiltin ? (category ? BUILTIN_RECIPES.filter(r => r.category === category).length : BUILTIN_RECIPES.length) : 0,
      custom_count: customRecipeDefs.length
    });
  } catch (error) {
    console.error('Error fetching recipes:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch recipes',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/recipes
 * Create a new custom recipe
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required fields
    const recipeData: Partial<RecipeDefinition> = {
      slug: body.slug,
      name: body.name,
      description: body.description,
      category: body.category,
      promptTemplate: body.promptTemplate || body.prompt_template,
      variables: body.variables || [],
      outputSchema: body.outputSchema || body.output_schema || {},
      version: body.version || 1
    };

    // Validate recipe structure
    const validation = validateRecipe(recipeData);
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

    // Check if slug already exists (in built-in or custom)
    const builtinExists = BUILTIN_RECIPES.some(r => r.slug === body.slug);
    if (builtinExists) {
      return NextResponse.json(
        {
          success: false,
          error: 'Recipe slug already exists as a built-in recipe',
          slug: body.slug
        },
        { status: 409 }
      );
    }

    const existingCustom = await prisma.recipe.findUnique({
      where: { slug: body.slug }
    });

    if (existingCustom) {
      return NextResponse.json(
        {
          success: false,
          error: 'Recipe slug already exists',
          slug: body.slug
        },
        { status: 409 }
      );
    }

    // Create recipe in database
    const recipe = await prisma.recipe.create({
      data: {
        slug: recipeData.slug!,
        name: recipeData.name!,
        description: recipeData.description,
        category: recipeData.category!,
        prompt_template: recipeData.promptTemplate!,
        variables: recipeData.variables as unknown as object,
        output_schema: recipeData.outputSchema as unknown as object,
        version: recipeData.version || 1,
        is_builtin: false
      }
    });

    return NextResponse.json(
      {
        success: true,
        recipe: {
          id: recipe.id,
          slug: recipe.slug,
          name: recipe.name,
          description: recipe.description,
          category: recipe.category,
          promptTemplate: recipe.prompt_template,
          variables: recipe.variables,
          outputSchema: recipe.output_schema,
          version: recipe.version,
          created_at: recipe.created_at,
          updated_at: recipe.updated_at
        }
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating recipe:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to create recipe',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
