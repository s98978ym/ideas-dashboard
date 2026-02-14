'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '../ui/Button';
import { Textarea } from '../ui/Textarea';
import { Badge } from '../ui/Badge';

interface ProviderInfo {
  id: string;
  name: string;
  uiUrl: string;
  supportsAutoExecute: boolean;
  autoExecuteReady: boolean;
}

interface WorkspaceInfo {
  id: string;
  name: string;
  channels: ChannelInfo[];
}

interface ChannelInfo {
  id: string;
  name: string;
  is_private: boolean;
}

interface RecipeRunnerProps {
  recipeSlug: string;
  recipeName: string;
  onComplete?: () => void;
  onClose: () => void;
}

type Step = 'select' | 'prompt' | 'executing' | 'paste' | 'complete';

export function RecipeRunner({ recipeSlug, recipeName, onComplete, onClose }: RecipeRunnerProps) {
  const [currentStep, setCurrentStep] = useState<Step>('select');
  const [workspaceId, setWorkspaceId] = useState('');
  const [channelId, setChannelId] = useState('');
  const [timeRange, setTimeRange] = useState('24h');
  const [selectedProvider, setSelectedProvider] = useState('gemini');
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [resultText, setResultText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [autoResult, setAutoResult] = useState('');

  useEffect(() => {
    fetch('/api/settings/llm')
      .then((r) => r.json())
      .then((data) => {
        setProviders(data.providers || []);
      })
      .catch(() => {});

    fetch('/api/workspaces')
      .then((r) => r.json())
      .then((data) => {
        setWorkspaces(data.workspaces || []);
      })
      .catch(() => {});
  }, []);

  const currentProvider = providers.find((p) => p.id === selectedProvider);
  const canAutoExecute = currentProvider?.supportsAutoExecute && currentProvider?.autoExecuteReady;
  const selectedWorkspace = workspaces.find((ws) => ws.id === workspaceId);

  // Auto-execute with Gemini OAuth
  const handleAutoExecute = async () => {
    setIsLoading(true);
    setError('');
    setCurrentStep('executing');

    try {
      const response = await fetch('/api/llm/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipe_slug: recipeSlug,
          workspace_id: workspaceId,
          channel_id: channelId,
          time_range: timeRange,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.message || data.error || 'Execution failed');

      setAutoResult(data.raw_result || JSON.stringify(data.parsed_data, null, 2));
      setCurrentStep('complete');
      if (onComplete) onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
      setCurrentStep('select');
    } finally {
      setIsLoading(false);
    }
  };

  // Generate prompt for manual copy/paste (Claude, ChatGPT)
  const handleGeneratePrompt = async () => {
    setIsLoading(true);
    setError('');

    try {
      const response = await fetch('/api/llm/generate-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipeSlug,
          variables: {
            workspaceId,
            channelId,
          },
        }),
      });

      if (!response.ok) throw new Error('プロンプト生成に失敗しました');
      const data = await response.json();
      setGeneratedPrompt(data.prompt);
      setCurrentStep('prompt');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyAndOpen = async () => {
    try {
      await navigator.clipboard.writeText(generatedPrompt);
      const url = currentProvider?.uiUrl;
      if (url) window.open(url, '_blank');
      setCurrentStep('paste');
    } catch {
      setError('クリップボードへのコピーに失敗しました');
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

      if (!response.ok) throw new Error('結果の解析に失敗しました');
      setCurrentStep('complete');
      if (onComplete) onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
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
            <h2 className="text-xl font-semibold text-gray-900">レシピ実行: {recipeName}</h2>
            <div className="mt-1 flex items-center gap-2">
              <Badge variant={currentStep === 'select' ? 'info' : 'default'}>1. 設定</Badge>
              <Badge variant={['executing', 'prompt', 'paste'].includes(currentStep) ? 'info' : 'default'}>2. 実行</Badge>
              <Badge variant={currentStep === 'complete' ? 'success' : 'default'}>3. 完了</Badge>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl font-bold">
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
                <label className="block text-sm font-medium text-gray-700 mb-1">ワークスペース</label>
                <select value={workspaceId} onChange={(e) => { setWorkspaceId(e.target.value); setChannelId(''); }} className="w-full px-3 py-2 border border-gray-300 rounded-md">
                  <option value="">選択してください...</option>
                  {workspaces.map((ws) => (
                    <option key={ws.id} value={ws.id}>{ws.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">チャンネル</label>
                <select value={channelId} onChange={(e) => setChannelId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md" disabled={!workspaceId}>
                  <option value="">選択してください...</option>
                  {selectedWorkspace?.channels.map((ch) => (
                    <option key={ch.id} value={ch.id}>{ch.is_private ? '🔒 ' : '#'}{ch.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">期間</label>
                <select value={timeRange} onChange={(e) => setTimeRange(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md">
                  <option value="24h">直近24時間</option>
                  <option value="7d">直近7日間</option>
                  <option value="30d">直近30日間</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">LLMプロバイダー</label>
                <div className="space-y-2">
                  {providers.map((p) => (
                    <label key={p.id} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="llm_provider"
                        value={p.id}
                        checked={selectedProvider === p.id}
                        onChange={(e) => setSelectedProvider(e.target.value)}
                      />
                      <span className="text-sm">{p.name}</span>
                      {p.supportsAutoExecute && p.autoExecuteReady && (
                        <Badge variant="success">自動実行可能</Badge>
                      )}
                      {p.supportsAutoExecute && !p.autoExecuteReady && (
                        <Badge variant="default">要APIキー設定</Badge>
                      )}
                      {!p.supportsAutoExecute && (
                        <Badge variant="default">手動 (WebUI)</Badge>
                      )}
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                {canAutoExecute && (
                  <Button
                    onClick={handleAutoExecute}
                    disabled={!workspaceId || !channelId || isLoading}
                    className="flex-1"
                  >
                    {isLoading ? '実行中...' : 'Geminiで自動実行'}
                  </Button>
                )}
                <Button
                  onClick={handleGeneratePrompt}
                  disabled={!workspaceId || !channelId || isLoading}
                  variant={canAutoExecute ? 'secondary' : 'primary'}
                  className="flex-1"
                >
                  {isLoading ? '生成中...' : 'プロンプトをコピーして手動実行'}
                </Button>
              </div>
            </div>
          )}

          {currentStep === 'executing' && (
            <div className="text-center py-12">
              <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4" />
              <p className="text-gray-700 font-medium">Geminiで実行中...</p>
              <p className="text-sm text-gray-500 mt-2">プロンプト生成 → Gemini API実行 → 結果解析</p>
            </div>
          )}

          {currentStep === 'prompt' && (
            <div className="space-y-4">
              <Textarea label="生成されたプロンプト" value={generatedPrompt} readOnly rows={12} className="font-mono text-sm" />
              <div className="flex gap-2">
                <Button onClick={handleCopyAndOpen} className="flex-1">
                  コピーして{currentProvider?.name || 'LLM'}を開く
                </Button>
                <Button variant="secondary" onClick={() => setCurrentStep('select')}>戻る</Button>
              </div>
              <p className="text-sm text-gray-600">
                プロンプトをコピーして{currentProvider?.name || 'LLM'}に貼り付けてください。結果を次のステップで貼り付けます。
              </p>
            </div>
          )}

          {currentStep === 'paste' && (
            <div className="space-y-4">
              <Textarea
                label="LLMのレスポンスを貼り付け (JSON形式)"
                value={resultText}
                onChange={(e) => setResultText(e.target.value)}
                rows={12}
                className="font-mono text-sm"
                placeholder='{"type": "summary", "data": {...}}'
              />
              <div className="flex gap-2">
                <Button onClick={handleParseResult} disabled={!resultText || isLoading} className="flex-1">
                  {isLoading ? '解析中...' : '解析して保存'}
                </Button>
                <Button variant="secondary" onClick={() => setCurrentStep('prompt')}>戻る</Button>
              </div>
            </div>
          )}

          {currentStep === 'complete' && (
            <div className="text-center py-8">
              <div className="text-green-600 text-5xl mb-4">&#10003;</div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">分析完了!</h3>
              <p className="text-gray-600 mb-4">結果が保存されました。</p>
              {autoResult && (
                <details className="text-left mb-4">
                  <summary className="text-sm text-gray-500 cursor-pointer hover:text-gray-700">結果を表示</summary>
                  <pre className="mt-2 p-3 bg-gray-50 rounded-md text-xs overflow-auto max-h-60">{autoResult}</pre>
                </details>
              )}
              <Button onClick={onClose}>閉じる</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
