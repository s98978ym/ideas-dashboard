'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardBody, CardFooter } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Textarea } from '@/components/ui/Textarea';
import type { DraftStatus, DraftSentVia } from '@/types';

interface Draft {
  id: string;
  channel_id: string;
  thread_ts?: string;
  text: string;
  status: DraftStatus;
  sent_via?: DraftSentVia;
  send_mode: string;
  last_send_error?: string;
  created_at: string;
  updated_at: string;
  channel?: {
    name: string;
    conversation_type?: string;
  };
  workspace?: {
    name: string;
  };
}

export default function DraftsPage() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingDraft, setEditingDraft] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [sendModeSettings, setSendModeSettings] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchDrafts();
  }, []);

  const fetchDrafts = async () => {
    setIsLoading(true);
    setError('');

    try {
      const response = await fetch('/api/drafts');
      if (!response.ok) {
        throw new Error('Failed to fetch drafts');
      }

      const data = await response.json();
      setDrafts(data.drafts || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEdit = (draft: Draft) => {
    setEditingDraft(draft.id);
    setEditText(draft.text);
  };

  const handleSaveEdit = async (draftId: string) => {
    try {
      const response = await fetch(`/api/drafts/${draftId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: editText }),
      });

      if (response.ok) {
        setDrafts(drafts.map(d =>
          d.id === draftId ? { ...d, text: editText, updated_at: new Date().toISOString() } : d
        ));
        setEditingDraft(null);
      }
    } catch (err) {
      console.error('Failed to update draft:', err);
    }
  };

  const handleSend = async (draftId: string, method: 'bot' | 'user_token') => {
    try {
      const response = await fetch(`/api/drafts/${draftId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method }),
      });

      if (response.ok) {
        setDrafts(drafts.map(d =>
          d.id === draftId ? { ...d, status: 'sent', sent_via: method, last_send_error: undefined } : d
        ));
      } else {
        const errorData = await response.json();
        setDrafts(drafts.map(d =>
          d.id === draftId ? { ...d, last_send_error: errorData.error || 'Failed to send' } : d
        ));
      }
    } catch (err) {
      console.error('Failed to send draft:', err);
      setDrafts(drafts.map(d =>
        d.id === draftId ? { ...d, last_send_error: err instanceof Error ? err.message : 'Unknown error' } : d
      ));
    }
  };

  const updateSendMode = async (draftId: string, mode: string) => {
    setSendModeSettings({ ...sendModeSettings, [draftId]: mode });
    try {
      await fetch(`/api/drafts/${draftId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ send_mode: mode }),
      });
      setDrafts(drafts.map(d =>
        d.id === draftId ? { ...d, send_mode: mode } : d
      ));
    } catch (err) {
      console.error('Failed to update send mode:', err);
    }
  };

  const handleCopyToClipboard = async (draft: Draft) => {
    try {
      await navigator.clipboard.writeText(draft.text);
      await fetch(`/api/drafts/${draft.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'copied', sent_via: 'copy' }),
      });

      setDrafts(drafts.map(d =>
        d.id === draft.id ? { ...d, status: 'copied', sent_via: 'copy' } : d
      ));
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  const handleDelete = async (draftId: string) => {
    if (!confirm('Are you sure you want to delete this draft?')) return;

    try {
      const response = await fetch(`/api/drafts/${draftId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setDrafts(drafts.filter(d => d.id !== draftId));
      }
    } catch (err) {
      console.error('Failed to delete draft:', err);
    }
  };

  const getStatusBadge = (status: DraftStatus) => {
    switch (status) {
      case 'draft': return <Badge variant="warning">Draft</Badge>;
      case 'sent': return <Badge variant="success">Sent</Badge>;
      case 'copied': return <Badge variant="info">Copied</Badge>;
      default: return <Badge variant="default">{status}</Badge>;
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Drafts</h1>
        <p className="text-gray-600 mt-1">Manage your AI-generated reply drafts</p>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md text-red-700">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12">
          <p className="text-gray-600">Loading drafts...</p>
        </div>
      ) : drafts.length === 0 ? (
        <Card>
          <CardBody className="text-center py-12">
            <p className="text-gray-600">No drafts yet</p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-4">
          {drafts.map(draft => (
            <Card key={draft.id}>
              <CardHeader className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {getStatusBadge(draft.status)}
                  {draft.workspace && <Badge variant="default">{draft.workspace.name}</Badge>}
                  {draft.channel && <Badge variant="default">#{draft.channel.name}</Badge>}
                  {draft.thread_ts && <Badge variant="info">Thread Reply</Badge>}
                </div>
                <span className="text-sm text-gray-500">
                  {new Date(draft.created_at).toLocaleDateString()}
                </span>
              </CardHeader>

              <CardBody>
                {editingDraft === draft.id ? (
                  <Textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    rows={6}
                    className="mb-4"
                  />
                ) : (
                  <>
                    <p className="text-gray-700 whitespace-pre-wrap">{draft.text}</p>
                    {draft.last_send_error && (
                      <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-md">
                        <p className="text-sm text-red-700">
                          <strong>Send Error:</strong> {draft.last_send_error}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </CardBody>

              <CardFooter className="flex flex-wrap gap-2 items-center">
                {editingDraft === draft.id ? (
                  <>
                    <Button size="sm" onClick={() => handleSaveEdit(draft.id)}>
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingDraft(null)}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    {draft.status === 'draft' && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => handleEdit(draft)}>
                          Edit
                        </Button>
                        <div className="flex items-center gap-2">
                          <label className="text-sm text-gray-600">Send as:</label>
                          <select
                            value={sendModeSettings[draft.id] || draft.send_mode || 'user'}
                            onChange={(e) => updateSendMode(draft.id, e.target.value)}
                            className="px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="user">User</option>
                            <option
                              value="bot"
                              disabled={draft.channel?.conversation_type === 'im'}
                            >
                              Bot {draft.channel?.conversation_type === 'im' ? '(N/A for DMs)' : ''}
                            </option>
                            <option value="copy">Copy Only</option>
                          </select>
                        </div>
                        {(sendModeSettings[draft.id] || draft.send_mode) === 'user' && (
                          <Button size="sm" onClick={() => handleSend(draft.id, 'user_token')}>
                            Send
                          </Button>
                        )}
                        {(sendModeSettings[draft.id] || draft.send_mode) === 'bot' &&
                         draft.channel?.conversation_type !== 'im' && (
                          <Button size="sm" onClick={() => handleSend(draft.id, 'bot')}>
                            Send
                          </Button>
                        )}
                      </>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => handleCopyToClipboard(draft)}>
                      Copy to Clipboard
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => handleDelete(draft.id)}>
                      Delete
                    </Button>
                  </>
                )}
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
