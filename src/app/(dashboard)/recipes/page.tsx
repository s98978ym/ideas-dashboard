'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { RecipeRunner } from '@/components/recipes/RecipeRunner';
import type { RecipeCategory } from '@/types';

interface Recipe {
  id: string;
  slug: string;
  name: string;
  category: RecipeCategory;
  description: string;
  version: string;
  is_active: boolean;
}

export default function RecipesPage() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);

  useEffect(() => {
    fetchRecipes();
  }, []);

  const fetchRecipes = async () => {
    setIsLoading(true);
    setError('');

    try {
      const response = await fetch('/api/recipes');
      if (!response.ok) {
        throw new Error('Failed to fetch recipes');
      }

      const data = await response.json();
      setRecipes(data.recipes || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const getCategoryBadge = (category: RecipeCategory) => {
    const variants: Record<RecipeCategory, 'success' | 'info' | 'warning' | 'error' | 'default'> = {
      summary: 'info',
      ideas: 'success',
      todos: 'warning',
      reply: 'error',
      custom: 'default',
    };
    return <Badge variant={variants[category]}>{category}</Badge>;
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Recipes</h1>
        <p className="text-gray-600 mt-1">AI-powered analysis workflows for your Slack messages</p>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md text-red-700">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12">
          <p className="text-gray-600">Loading recipes...</p>
        </div>
      ) : recipes.length === 0 ? (
        <Card>
          <CardBody className="text-center py-12">
            <p className="text-gray-600">No recipes available</p>
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {recipes.map(recipe => (
            <Card key={recipe.id} className={!recipe.is_active ? 'opacity-50' : ''}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <h3 className="text-lg font-semibold">{recipe.name}</h3>
                  {getCategoryBadge(recipe.category)}
                </div>
              </CardHeader>
              <CardBody>
                <p className="text-gray-700 text-sm mb-4">{recipe.description}</p>

                <div className="flex items-center justify-between text-xs text-gray-500 mb-4">
                  <span>Version {recipe.version}</span>
                  {recipe.is_active ? (
                    <Badge variant="success">Active</Badge>
                  ) : (
                    <Badge variant="default">Inactive</Badge>
                  )}
                </div>

                <Button
                  onClick={() => setSelectedRecipe(recipe)}
                  disabled={!recipe.is_active}
                  className="w-full"
                  size="sm"
                >
                  Run Recipe
                </Button>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {selectedRecipe && (
        <RecipeRunner
          recipeSlug={selectedRecipe.slug}
          recipeName={selectedRecipe.name}
          onComplete={() => {
            setSelectedRecipe(null);
            // Optionally refresh data or show success message
          }}
          onClose={() => setSelectedRecipe(null)}
        />
      )}
    </div>
  );
}
