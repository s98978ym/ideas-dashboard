'use client';

import { useState, useEffect } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

interface Provider {
  id: string;
  name: string;
  uiUrl: string;
  supportsAutoExecute: boolean;
  autoExecuteReady: boolean;
  defaultModel: string;
}

const GEMINI_MODELS = [
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (高速)' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (高精度)' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (バランス)' },
];

export default function SettingsPage() {
  const { data: session } = useSession();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [geminiModel, setGeminiModel] = useState('gemini-2.0-flash');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetchProviders();
  }, []);

  const fetchProviders = async () => {
    try {
      const res = await fetch('/api/settings/llm');
      const data = await res.json();
      setProviders(data.providers || []);
      const gemini = (data.providers || []).find((p: Provider) => p.id === 'gemini');
      if (gemini?.defaultModel) setGeminiModel(gemini.defaultModel);
    } catch {
      setMessage('設定の読み込みに失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveModel = async () => {
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch('/api/settings/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: geminiModel }),
      });
      const data = await res.json();
      if (data.success) {
        setProviders(data.providers || providers);
        setMessage('Geminiモデルを保存しました');
      } else {
        setMessage(data.error || '保存に失敗しました');
      }
    } catch {
      setMessage('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">設定</h1>
        <p className="text-gray-600 mt-1">LLMプロバイダーとアカウント設定</p>
      </div>

      {message && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md text-blue-700 text-sm">
          {message}
        </div>
      )}

      {/* Google Account Section */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h3 className="font-semibold text-lg">Googleアカウント</h3>
              <Badge variant={session?.user ? 'success' : 'default'}>
                {session?.user ? 'ログイン中' : '未ログイン'}
              </Badge>
            </div>
            {session?.user && (
              <Button size="sm" variant="secondary" onClick={() => signOut()}>
                ログアウト
              </Button>
            )}
          </div>
        </CardHeader>
        <CardBody>
          {session?.user ? (
            <div className="flex items-center gap-3">
              {session.user.image && (
                <img
                  src={session.user.image}
                  alt=""
                  className="w-10 h-10 rounded-full"
                />
              )}
              <div>
                <p className="font-medium text-gray-900">{session.user.name}</p>
                <p className="text-sm text-gray-500">{session.user.email}</p>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-sm text-gray-500 mb-3">
                Googleアカウントでログインすると、Geminiの自動実行が利用可能になります。
              </p>
              <button
                onClick={() => signIn('google', { callbackUrl: '/settings' })}
                className="inline-flex items-center gap-3 px-5 py-2.5 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50 transition-colors"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
                <span className="text-gray-700 font-medium">Googleでログイン</span>
              </button>
            </div>
          )}
        </CardBody>
      </Card>

      {isLoading ? (
        <p className="text-gray-500">読み込み中...</p>
      ) : (
        <div className="space-y-4">
          {/* Gemini - Auto Execute */}
          {providers
            .filter((p) => p.id === 'gemini')
            .map((p) => (
              <Card key={p.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <h3 className="font-semibold text-lg">{p.name}</h3>
                      <Badge variant={p.autoExecuteReady ? 'success' : 'default'}>
                        {p.autoExecuteReady ? '自動実行可能' : 'ログインが必要'}
                      </Badge>
                    </div>
                    <Badge variant="info">自動実行</Badge>
                  </div>
                </CardHeader>
                <CardBody>
                  <p className="text-sm text-gray-600 mb-3">
                    Googleログインを利用して、Gemini APIを自動実行します。APIキーは不要です。
                  </p>
                  <div className="flex items-end gap-3">
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        モデル
                      </label>
                      <select
                        value={geminiModel}
                        onChange={(e) => setGeminiModel(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                      >
                        {GEMINI_MODELS.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <Button onClick={handleSaveModel} disabled={saving} size="sm">
                      {saving ? '保存中...' : '保存'}
                    </Button>
                  </div>
                </CardBody>
              </Card>
            ))}

          {/* Claude & ChatGPT - WebUI */}
          {providers
            .filter((p) => p.id !== 'gemini')
            .map((p) => (
              <Card key={p.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <h3 className="font-semibold text-lg">{p.name}</h3>
                    </div>
                    <Badge variant="default">手動 (WebUI)</Badge>
                  </div>
                </CardHeader>
                <CardBody>
                  <p className="text-sm text-gray-600 mb-3">
                    プロンプトをコピーして、{p.name}のWebサイトに貼り付けて実行します。
                  </p>
                  <a
                    href={p.uiUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
                  >
                    {p.uiUrl} を開く
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </CardBody>
              </Card>
            ))}
        </div>
      )}
    </div>
  );
}
