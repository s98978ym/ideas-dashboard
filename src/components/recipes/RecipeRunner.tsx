'use client';

import React, { useState } from 'react';
import { Button } from '../ui/Button';
import { Textarea } from '../ui/Textarea';
import { Badge } from '../ui/Badge';
import type { LLMProvider } from '@/types';

interface RecipeRunnerProps {
  recipeSlug: string;
  recipeName: string;
  onComplete?: () => void;
  onClose: () => void;
}

type Step = 'select' | 'prompt' | 'paste' | 'complete';

export function RecipeRunner({ recipeSlug, recipeName, onComplete, onClose }: RecipeRunnerProps) {
  const [currentStep, setCurrentStep] = useState<Step>('select');
  const [workspaceId, setWorkspaceId] = useState('');
  const [channelId, setChannelId] = useState('');
  const [timeRange, setTimeRange] = useState('24h');
  const [llmProvider, setLlmProvider] = useState<LLMProvider>('claude');
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [resultText, setResultText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleGeneratePrompt = async () => {
    setIsLoading(true);
    setError('');

    try {
      const response = await fetch('/api/llm/generate-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipe_slug: recipeSlug,
          workspace_id: workspaceId,
          channel_id: channelId,
          time_range: timeRange,
          llm_provider: llmProvider,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate prompt');
      }

      const data = await response.json();
      setGeneratedPrompt(data.prompt);
      setCurrentStep('prompt');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(generatedPrompt);
      setCurrentStep('paste');
    } catch (err) {
      setError('Failed to copy to clipboard');
    }
  };

  const handleParseResult = async () => {
    setIsLoading(true);
    setError('');

    try {
      const response = await fetch('/api/llm/parse-result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipe_slug: recipeSlug,
          result_text: resultText,
          workspace_id: workspaceId,
          channel_id: channelId,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to parse result');
      }

      const data = await response.json();
      setCurrentStep('complete');

      if (onComplete) {
        onComplete();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Run Recipe: {recipeName}</h2>
            <div className="mt-1 flex items-center gap-2">
              <Badge variant={currentStep === 'select' ? 'info' : 'default'}>1. Select Scope</Badge>
              <Badge variant={currentStep === 'prompt' ? 'info' : 'default'}>2. Generate Prompt</Badge>
              <Badge variant={currentStep === 'paste' ? 'info' : 'default'}>3. Paste Result</Badge>
              <Badge variant={currentStep === 'complete' ? 'success' : 'default'}>4. Complete</Badge>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl font-bold"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
              {error}
            </div>
          )}

          {currentStep === 'select' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Workspace
                </label>
                <select
                  value={workspaceId}
                  onChange={(e) => setWorkspaceId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                >
                  <option value="">Select workspace...</option>
                  <option value="ws_1">Workspace 1</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Channel
                </label>
                <select
                  value={channelId}
                  onChange={(e) => setChannelId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                >
                  <option value="">Select channel...</option>
                  <option value="ch_1">general</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Time Range
                </label>
                <select
                  value={timeRange}
                  onChange={(e) => setTimeRange(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                >
                  <option value="24h">Last 24 hours</option>
                  <option value="7d">Last 7 days</option>
                  <option value="30d">Last 30 days</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  LLM Provider
                </label>
                <div className="space-y-2">
                  {(['claude', 'chatgpt', 'gemini'] as LLMProvider[]).map((provider) => (
                    <label key={provider} className="flex items-center">
                      <input
                        type="radio"
                        name="llm_provider"
                        value={provider}
                        checked={llmProvider === provider}
                        onChange={(e) => setLlmProvider(e.target.value as LLMProvider)}
                        className="mr-2"
                      />
                      <span className="text-sm capitalize">{provider}</span>
                    </label>
                  ))}
                </div>
              </div>

              <Button
                onClick={handleGeneratePrompt}
                disabled={!workspaceId || !channelId || isLoading}
                className="w-full"
              >
                {isLoading ? 'Generating...' : 'Generate Prompt'}
              </Button>
            </div>
          )}

          {currentStep === 'prompt' && (
            <div className="space-y-4">
              <Textarea
                label="Generated Prompt"
                value={generatedPrompt}
                readOnly
                rows={12}
                className="font-mono text-sm"
              />
              <div className="flex gap-2">
                <Button onClick={handleCopyPrompt} className="flex-1">
                  Copy to Clipboard
                </Button>
                <Button variant="secondary" onClick={() => setCurrentStep('select')}>
                  Back
                </Button>
              </div>
              <p className="text-sm text-gray-600">
                Copy the prompt above and paste it into your LLM ({llmProvider}). Then paste the response in the next step.
              </p>
            </div>
          )}

          {currentStep === 'paste' && (
            <div className="space-y-4">
              <Textarea
                label="Paste LLM Response (JSON format)"
                value={resultText}
                onChange={(e) => setResultText(e.target.value)}
                rows={12}
                className="font-mono text-sm"
                placeholder='{"type": "summary", "data": {...}}'
              />
              <div className="flex gap-2">
                <Button
                  onClick={handleParseResult}
                  disabled={!resultText || isLoading}
                  className="flex-1"
                >
                  {isLoading ? 'Parsing...' : 'Parse & Save'}
                </Button>
                <Button variant="secondary" onClick={() => setCurrentStep('prompt')}>
                  Back
                </Button>
              </div>
            </div>
          )}

          {currentStep === 'complete' && (
            <div className="text-center py-8">
              <div className="text-green-600 text-5xl mb-4">✓</div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Analysis Complete!</h3>
              <p className="text-gray-600 mb-6">
                The recipe has been executed and results have been saved.
              </p>
              <Button onClick={onClose}>Close</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
