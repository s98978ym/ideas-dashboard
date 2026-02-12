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
  created_at: string;
  updated_at: string;
  channel?: {
    name: string;
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

  const handleSendViaBot = async (draftId: string) => {
    try {
      const response = await fetch(`/api/drafts/${draftId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'bot' }),
      });

      if (response.ok) {
        setDrafts(drafts.map(d =>
          d.id === draftId ? { ...d, status: 'sent', sent_via: 'bot' } : d
        ));
      }
    } catch (err) {
      console.error('Failed to send draft:', err);
    }
  };

  const handleSendViaUserToken = async (draftId: string) => {
    try {
      const response = await fetch(`/api/drafts/${draftId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'user_token' }),
      });

      if (response.ok) {
        setDrafts(drafts.map(d =>
          d.id === draftId ? { ...d, status: 'sent', sent_via: 'user_token' } : d
        ));
      }
    } catch (err) {
      console.error('Failed to send draft:', err);
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
                  <p className="text-gray-700 whitespace-pre-wrap">{draft.text}</p>
                )}
              </CardBody>

              <CardFooter className="flex flex-wrap gap-2">
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
                        <Button size="sm" onClick={() => handleSendViaBot(draft.id)}>
                          Send via Bot
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => handleSendViaUserToken(draft.id)}>
                          Send via User
                        </Button>
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
