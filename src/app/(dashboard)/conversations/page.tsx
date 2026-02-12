'use client';

import { useState, useEffect } from 'react';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

interface Conversation {
  id: string;
  slack_channel_id: string;
  name: string;
  conversation_type: string;
  is_private: boolean;
  is_monitored: boolean;
  participants: string[] | null;
  message_count: number;
  workspace: { name: string; team_id: string };
  updated_at: string;
}

type FilterType = 'all' | 'channel' | 'private_channel' | 'im' | 'mpim';

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');

  useEffect(() => {
    fetchConversations();
  }, []);

  const fetchConversations = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/conversations');
      const data = await res.json();
      setConversations(data.conversations || []);
    } catch (err) {
      console.error('Failed to fetch conversations:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const filtered = conversations.filter(c =>
    filter === 'all' ? true : c.conversation_type === filter
  );

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'channel': return 'Channel';
      case 'private_channel': return 'Private';
      case 'im': return 'DM';
      case 'mpim': return 'Group DM';
      default: return 'Channel';
    }
  };

  const getTypeBadgeVariant = (type: string): 'default' | 'info' | 'warning' | 'success' | 'error' => {
    switch (type) {
      case 'im': return 'info';
      case 'mpim': return 'warning';
      case 'private_channel': return 'success';
      default: return 'default';
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Conversations</h1>
        <p className="text-gray-600 mt-1">All channels and DMs across workspaces</p>
      </div>

      {/* Filter Tabs */}
      <div className="mb-6 flex gap-2 border-b border-gray-200">
        {([
          { key: 'all', label: 'All' },
          { key: 'channel', label: 'Channels' },
          { key: 'private_channel', label: 'Private' },
          { key: 'im', label: 'DMs' },
          { key: 'mpim', label: 'Group DMs' },
        ] as { key: FilterType; label: string }[]).map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              filter === tab.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-center py-12">
          <p className="text-gray-600">Loading conversations...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-600">No conversations found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(conv => (
            <Card key={conv.id}>
              <CardBody>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-mono text-gray-400 w-6 text-center">
                      {conv.conversation_type === 'channel' ? '#' : conv.conversation_type === 'private_channel' ? 'P' : 'D'}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900">{conv.name}</span>
                        <Badge variant={getTypeBadgeVariant(conv.conversation_type)}>
                          {getTypeLabel(conv.conversation_type)}
                        </Badge>
                        <Badge variant="default">{conv.workspace.name}</Badge>
                      </div>
                      <p className="text-sm text-gray-500 mt-0.5">
                        {conv.message_count} messages
                        {conv.participants && Array.isArray(conv.participants) && conv.participants.length > 0 && (
                          <> &middot; {conv.participants.length} participants</>
                        )}
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      window.location.href = `/conversations/${conv.id}`;
                    }}
                  >
                    View
                  </Button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
