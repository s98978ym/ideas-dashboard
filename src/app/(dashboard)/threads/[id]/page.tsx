'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { RecipeRunner } from '@/components/recipes/RecipeRunner';
import { SlackText } from '@/components/ui/SlackText';

interface Message {
  id: string;
  slack_ts: string;
  text: string;
  user_name?: string;
  created_at: string;
  thread_ts?: string;
  is_thread_reply: boolean;
}

interface Thread {
  message: Message;
  replies: Message[];
  workspace: {
    id: string;
    name: string;
  };
  channel: {
    id: string;
    name: string;
  };
}

export default function ThreadPage() {
  const params = useParams();
  const messageId = params.id as string;

  const [thread, setThread] = useState<Thread | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedRecipe, setSelectedRecipe] = useState<{ slug: string; name: string } | null>(null);

  useEffect(() => {
    if (messageId) {
      fetchThread();
    }
  }, [messageId]);

  const fetchThread = async () => {
    setIsLoading(true);
    setError('');

    try {
      const response = await fetch(`/api/messages/${messageId}/thread`);
      if (!response.ok) {
        throw new Error('Failed to fetch thread');
      }

      const data = await response.json();
      setThread(data.thread);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAnalyze = () => {
    setSelectedRecipe({ slug: 'summary', name: 'Summary Analysis' });
  };

  const handleDraftReply = () => {
    setSelectedRecipe({ slug: 'reply_draft', name: 'Draft Reply' });
  };

  const handleExtractTodos = () => {
    setSelectedRecipe({ slug: 'todo_extraction', name: 'Extract TODOs' });
  };

  if (isLoading) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600">Loading thread...</p>
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

  if (!thread) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600">Thread not found</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Main Thread Area */}
      <div className="lg:col-span-2">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Thread View</h1>
          <div className="flex items-center gap-2 mt-2">
            <Badge variant="default">{thread.workspace.name}</Badge>
            <Badge variant="default">#{thread.channel.name}</Badge>
          </div>
        </div>

        {/* Parent Message */}
        <Card className="mb-4">
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-lg">
                  {thread.message.user_name || 'Unknown User'}
                </h3>
                <p className="text-sm text-gray-500">
                  {new Date(thread.message.created_at).toLocaleString()}
                </p>
              </div>
              <Badge variant="info">Parent Message</Badge>
            </div>
          </CardHeader>
          <CardBody>
            <p className="text-gray-700 whitespace-pre-wrap">
              <SlackText text={thread.message.text} />
            </p>
          </CardBody>
        </Card>

        {/* Thread Replies */}
        {thread.replies.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900">
              Replies ({thread.replies.length})
            </h2>
            {thread.replies.map((reply) => (
              <Card key={reply.id} className="ml-8">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-semibold">{reply.user_name || 'Unknown User'}</h4>
                      <p className="text-sm text-gray-500">
                        {new Date(reply.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardBody>
                  <p className="text-gray-700 whitespace-pre-wrap">
                    <SlackText text={reply.text} />
                  </p>
                </CardBody>
              </Card>
            ))}
          </div>
        )}

        {thread.replies.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            <p>No replies in this thread yet</p>
          </div>
        )}
      </div>

      {/* Actions Panel */}
      <div className="lg:col-span-1">
        <Card className="sticky top-4">
          <CardHeader>
            <h3 className="font-semibold text-lg">Actions</h3>
          </CardHeader>
          <CardBody className="space-y-3">
            <Button onClick={handleAnalyze} className="w-full">
              Analyze Thread
            </Button>
            <Button onClick={handleDraftReply} variant="secondary" className="w-full">
              Draft Reply
            </Button>
            <Button onClick={handleExtractTodos} variant="secondary" className="w-full">
              Extract TODOs
            </Button>

            <div className="pt-4 border-t border-gray-200">
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Thread Info</h4>
              <div className="space-y-2 text-sm text-gray-600">
                <p>Messages: {1 + thread.replies.length}</p>
                <p>Workspace: {thread.workspace.name}</p>
                <p>Channel: #{thread.channel.name}</p>
                <p>Started: {new Date(thread.message.created_at).toLocaleDateString()}</p>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      {selectedRecipe && (
        <RecipeRunner
          recipeSlug={selectedRecipe.slug}
          recipeName={selectedRecipe.name}
          onComplete={() => {
            setSelectedRecipe(null);
          }}
          onClose={() => setSelectedRecipe(null)}
        />
      )}
    </div>
  );
}
