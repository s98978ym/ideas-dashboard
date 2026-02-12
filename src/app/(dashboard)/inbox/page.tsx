'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import type { InboxReason } from '@/types';

interface InboxItem {
  id: string;
  reason: InboxReason;
  is_read: boolean;
  is_archived: boolean;
  created_at: string;
  message: {
    id: string;
    slack_ts: string;
    slack_channel_id: string;
    text: string;
    user_name?: string;
    thread_ts?: string;
    created_at: string;
  };
  workspace: {
    name: string;
  };
  channel: {
    name: string;
  };
}

type FilterTab = 'all' | 'unread' | 'dms' | 'mentions' | 'threads' | 'keywords';

export default function InboxPage() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');

  useEffect(() => {
    fetchInboxItems();
  }, []);

  const fetchInboxItems = async () => {
    setIsLoading(true);
    setError('');

    try {
      const response = await fetch('/api/messages/inbox');
      if (!response.ok) {
        throw new Error('Failed to fetch inbox items');
      }

      const data = await response.json();
      setItems(data.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleMarkAsRead = async (itemId: string) => {
    try {
      const response = await fetch(`/api/messages/inbox/${itemId}/read`, {
        method: 'POST',
      });

      if (response.ok) {
        setItems(items.map(item =>
          item.id === itemId ? { ...item, is_read: true } : item
        ));
      }
    } catch (err) {
      console.error('Failed to mark as read:', err);
    }
  };

  const handleArchive = async (itemId: string) => {
    try {
      const response = await fetch(`/api/messages/inbox/${itemId}/archive`, {
        method: 'POST',
      });

      if (response.ok) {
        setItems(items.filter(item => item.id !== itemId));
      }
    } catch (err) {
      console.error('Failed to archive:', err);
    }
  };

  const filteredItems = items.filter(item => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'unread') return !item.is_read;
    if (activeFilter === 'dms') return item.reason === 'dm' || item.reason === 'keyword';
    if (activeFilter === 'mentions') return item.reason === 'mention';
    if (activeFilter === 'threads') return item.reason === 'related';
    if (activeFilter === 'keywords') return item.reason === 'keyword';
    return true;
  });

  const getReasonBadgeVariant = (reason: InboxReason) => {
    switch (reason) {
      case 'mention': return 'info';
      case 'keyword': return 'warning';
      case 'rule': return 'success';
      default: return 'default';
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Inbox</h1>
        <p className="text-gray-600 mt-1">Messages that need your attention</p>
      </div>

      {/* Filter Tabs */}
      <div className="mb-6 flex gap-2 border-b border-gray-200">
        {(['all', 'unread', 'dms', 'mentions', 'threads', 'keywords'] as FilterTab[]).map(filter => (
          <button
            key={filter}
            onClick={() => setActiveFilter(filter)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
              activeFilter === filter
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            {filter}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md text-red-700">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12">
          <p className="text-gray-600">Loading inbox...</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-600">No messages to display</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredItems.map(item => (
            <Card key={item.id} className={item.is_read ? 'opacity-60' : ''}>
              <CardBody>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-semibold text-gray-900">
                        {item.message.user_name || 'Unknown User'}
                      </span>
                      <Badge variant="default">{item.workspace.name}</Badge>
                      <Badge variant="default">#{item.channel.name}</Badge>
                      <Badge variant={getReasonBadgeVariant(item.reason)}>
                        {item.reason}
                      </Badge>
                      {!item.is_read && (
                        <Badge variant="info">New</Badge>
                      )}
                    </div>

                    <p className="text-gray-700 mb-2">
                      {item.message.text.substring(0, 200)}
                      {item.message.text.length > 200 && '...'}
                    </p>

                    <p className="text-sm text-gray-500">
                      {new Date(item.message.created_at).toLocaleString()}
                      {item.message.thread_ts && ' • In thread'}
                    </p>
                  </div>

                  <div className="ml-4 flex gap-2">
                    {!item.is_read && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleMarkAsRead(item.id)}
                      >
                        Mark Read
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleArchive(item.id)}
                    >
                      Archive
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        window.location.href = `/threads/${item.message.id}`;
                      }}
                    >
                      View
                    </Button>
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
