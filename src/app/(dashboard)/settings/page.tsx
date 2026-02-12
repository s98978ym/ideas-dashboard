'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

interface Provider {
  id: string;
  name: string;
  apiConfigured: boolean;
  defaultModel: string;
}

export default function SettingsPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [modelId, setModelId] = useState('');
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
    } catch {
      setMessage('Failed to load settings');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async (providerId: string) => {
    if (!apiKey.trim()) return;
    setSaving(true);
    setMessage('');

    try {
      const res = await fetch('/api/settings/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: providerId,
          api_key: apiKey,
          model_id: modelId || undefined,
        }),
      });
      const data = await res.json();

      if (data.success) {
        setProviders(data.providers || providers);
        setEditingProvider(null);
        setApiKey('');
        setModelId('');
        setMessage(`${providerId} API key saved successfully`);
      } else {
        setMessage(data.error || 'Failed to save');
      }
    } catch {
      setMessage('Failed to save API key');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (providerId: string) => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerId, action: 'remove' }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchProviders();
        setMessage(`${providerId} API key removed`);
      }
    } catch {
      setMessage('Failed to remove');
    } finally {
      setSaving(false);
    }
  };

  const modelOptions: Record<string, string[]> = {
    claude: ['claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001', 'claude-opus-4-6'],
    chatgpt: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o3-mini'],
    gemini: ['gemini-2.0-flash', 'gemini-2.5-pro', 'gemini-2.5-flash'],
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-600 mt-1">Configure LLM API keys for auto-execution</p>
      </div>

      {message && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md text-blue-700 text-sm">
          {message}
        </div>
      )}

      {isLoading ? (
        <p className="text-gray-500">Loading...</p>
      ) : (
        <div className="space-y-4">
          {providers.map((p) => (
            <Card key={p.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <h3 className="font-semibold text-lg">{p.name}</h3>
                    <Badge variant={p.apiConfigured ? 'success' : 'default'}>
                      {p.apiConfigured ? 'Connected' : 'Not configured'}
                    </Badge>
                  </div>
                  <div className="flex gap-2">
                    {p.apiConfigured && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleRemove(p.id)}
                        disabled={saving}
                      >
                        Remove
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={() => {
                        setEditingProvider(editingProvider === p.id ? null : p.id);
                        setApiKey('');
                        setModelId(p.defaultModel);
                      }}
                    >
                      {p.apiConfigured ? 'Update' : 'Configure'}
                    </Button>
                  </div>
                </div>
              </CardHeader>

              {editingProvider === p.id && (
                <CardBody>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        API Key
                      </label>
                      <input
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder={`Enter ${p.name} API key...`}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Model
                      </label>
                      <select
                        value={modelId}
                        onChange={(e) => setModelId(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                      >
                        {(modelOptions[p.id] || []).map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={() => handleSave(p.id)} disabled={!apiKey.trim() || saving}>
                        {saving ? 'Saving...' : 'Save'}
                      </Button>
                      <Button variant="secondary" onClick={() => setEditingProvider(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                </CardBody>
              )}

              {!editingProvider && p.apiConfigured && (
                <CardBody>
                  <p className="text-sm text-gray-500">Model: {p.defaultModel}</p>
                </CardBody>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
