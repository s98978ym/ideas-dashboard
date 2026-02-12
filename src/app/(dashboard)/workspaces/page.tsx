'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import type { WorkspaceStatus } from '@/types';

interface Channel {
  id: string;
  slack_channel_id: string;
  name: string;
  is_monitored: boolean;
}

interface Workspace {
  id: string;
  team_id: string;
  name: string;
  status: WorkspaceStatus;
  has_user_token: boolean;
  last_dm_sync_at?: string;
  created_at: string;
  channels: Channel[];
}

export default function WorkspacesPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [expandedWorkspace, setExpandedWorkspace] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchWorkspaces();
  }, []);

  const fetchWorkspaces = async () => {
    setIsLoading(true);
    setError('');

    try {
      const response = await fetch('/api/workspaces');
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || data.error || 'Failed to fetch workspaces');
      }

      setWorkspaces(data.workspaces || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleChannelMonitoring = async (workspaceId: string, channelId: string, currentStatus: boolean) => {
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/channels/${channelId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_monitored: !currentStatus }),
      });

      if (response.ok) {
        setWorkspaces(workspaces.map(ws =>
          ws.id === workspaceId
            ? {
                ...ws,
                channels: ws.channels.map(ch =>
                  ch.id === channelId ? { ...ch, is_monitored: !currentStatus } : ch
                ),
              }
            : ws
        ));
      }
    } catch (err) {
      console.error('Failed to toggle channel monitoring:', err);
    }
  };

  const handleSyncDMs = async (workspaceId: string) => {
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/sync-dms`, {
        method: 'POST',
      });

      if (response.ok) {
        const data = await response.json();
        alert(`DM sync initiated. ${data.dm_count || 0} DMs discovered.`);
        fetchWorkspaces();
      } else {
        const errorData = await response.json();
        alert(`Failed to sync DMs: ${errorData.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Failed to sync DMs:', err);
      alert('Failed to sync DMs');
    }
  };

  const getStatusBadge = (status: WorkspaceStatus) => {
    switch (status) {
      case 'active': return <Badge variant="success">Active</Badge>;
      case 'suspended': return <Badge variant="warning">Suspended</Badge>;
      case 'uninstalled': return <Badge variant="error">Uninstalled</Badge>;
      default: return <Badge variant="default">{status}</Badge>;
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Workspaces</h1>
          <p className="text-gray-600 mt-1">Manage your connected Slack workspaces</p>
        </div>
        <a href="/api/slack/oauth">
          <Button>Add Workspace</Button>
        </a>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md text-red-700">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12">
          <p className="text-gray-600">Loading workspaces...</p>
        </div>
      ) : workspaces.length === 0 ? (
        <Card>
          <CardBody className="text-center py-12">
            <p className="text-gray-600 mb-4">No workspaces connected yet</p>
            <a href="/api/slack/oauth">
              <Button>Connect Your First Workspace</Button>
            </a>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-4">
          {workspaces.map(workspace => (
            <Card key={workspace.id}>
              <CardHeader className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-semibold">{workspace.name}</h3>
                  {getStatusBadge(workspace.status)}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setExpandedWorkspace(
                      expandedWorkspace === workspace.id ? null : workspace.id
                    )
                  }
                >
                  {expandedWorkspace === workspace.id ? 'Collapse' : 'Expand'}
                </Button>
              </CardHeader>
              <CardBody>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                  <div>
                    <p className="text-sm text-gray-600">Team ID</p>
                    <p className="font-mono text-sm">{workspace.team_id}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Connected</p>
                    <p className="text-sm">{new Date(workspace.created_at).toLocaleDateString()}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Channels</p>
                    <p className="text-sm">{workspace.channels.length} channels</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">User Token</p>
                    <div className="flex items-center gap-2">
                      {workspace.has_user_token ? (
                        <Badge variant="success">Active</Badge>
                      ) : (
                        <Badge variant="warning">Missing</Badge>
                      )}
                    </div>
                  </div>
                </div>

                {/* DM Sync Section */}
                <div className="mb-4 p-4 bg-gray-50 rounded-md border border-gray-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-semibold text-sm text-gray-900">Direct Messages</h4>
                      <p className="text-xs text-gray-600 mt-1">
                        {workspace.last_dm_sync_at
                          ? `Last synced: ${new Date(workspace.last_dm_sync_at).toLocaleString()}`
                          : 'Never synced'}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {workspace.has_user_token ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleSyncDMs(workspace.id)}
                        >
                          Sync DMs Now
                        </Button>
                      ) : (
                        <a href={`/api/slack/oauth?workspace_id=${workspace.id}&scope=user`}>
                          <Button size="sm" variant="warning">
                            Install User Token
                          </Button>
                        </a>
                      )}
                    </div>
                  </div>
                  {!workspace.has_user_token && (
                    <p className="text-xs text-amber-600 mt-2">
                      User token required to sync DMs and send messages as yourself
                    </p>
                  )}
                </div>

                {expandedWorkspace === workspace.id && workspace.channels.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <h4 className="font-semibold mb-3">Monitored Channels</h4>
                    <div className="space-y-2">
                      {workspace.channels.map(channel => (
                        <div
                          key={channel.id}
                          className="flex items-center justify-between p-3 bg-gray-50 rounded-md"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-medium">#{channel.name}</span>
                            {channel.is_monitored && (
                              <Badge variant="success">Monitored</Badge>
                            )}
                          </div>
                          <Button
                            size="sm"
                            variant={channel.is_monitored ? 'destructive' : 'primary'}
                            onClick={() =>
                              toggleChannelMonitoring(workspace.id, channel.id, channel.is_monitored)
                            }
                          >
                            {channel.is_monitored ? 'Disable' : 'Enable'}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
