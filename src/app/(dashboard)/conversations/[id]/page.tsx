'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { SlackText } from '@/components/ui/SlackText';

interface Message {
  id: string;
  slack_ts: string;
  text: string;
  user_id?: string;
  user_name?: string;
  created_at: string;
  thread_ts?: string;
  is_thread_reply: boolean;
}

interface ConversationDetail {
  channel: {
    id: string;
    slack_channel_id: string;
    name: string;
    conversation_type: string;
    participants: string[] | null;
  };
  workspace: { id: string; name: string };
  messages: Message[];
  pagination: { total: number; hasMore: boolean };
}

export default function ConversationDetailPage() {
  const params = useParams();
  const channelId = params.id as string;

  const [data, setData] = useState<ConversationDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (channelId) fetchMessages();
  }, [channelId]);

  const fetchMessages = async () => {
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/conversations/${channelId}/messages`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to fetch messages');
      }
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'im': return 'DM';
      case 'mpim': return 'Group DM';
      case 'private_channel': return 'Private Channel';
      default: return 'Channel';
    }
  };

  if (isLoading) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600">Loading messages...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-md text-red-700">
        {error}
      </div>
    );
  }

  // Build a user ID → display name map from loaded messages
  const userMap = new Map<string, string>();
  if (data) {
    for (const msg of data.messages) {
      if (msg.user_id && msg.user_name) {
        userMap.set(msg.user_id, msg.user_name);
      }
    }
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600">Conversation not found</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Button variant="secondary" size="sm" onClick={() => window.history.back()}>
            &larr; Back
          </Button>
        </div>
        <h1 className="text-3xl font-bold text-gray-900">{data.channel.name}</h1>
        <div className="flex items-center gap-2 mt-2">
          <Badge variant="default">{data.workspace.name}</Badge>
          <Badge variant="info">{getTypeLabel(data.channel.conversation_type)}</Badge>
          <span className="text-sm text-gray-500">{data.pagination.total} messages</span>
        </div>
      </div>

      {data.messages.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-600">No messages in this conversation</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.messages.map((msg) => (
            <Card key={msg.id}>
              <CardBody>
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-gray-900 text-sm">
                        {msg.user_name || msg.user_id || 'Unknown'}
                      </span>
                      <span className="text-xs text-gray-400">
                        {new Date(msg.created_at).toLocaleString()}
                      </span>
                      {msg.is_thread_reply && (
                        <Badge variant="default">reply</Badge>
                      )}
                    </div>
                    <p className="text-gray-700 whitespace-pre-wrap text-sm">
                      <SlackText text={msg.text} userMap={userMap} />
                    </p>
                  </div>
                  {msg.thread_ts && !msg.is_thread_reply && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => { window.location.href = `/threads/${msg.id}`; }}
                    >
                      Thread
                    </Button>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
