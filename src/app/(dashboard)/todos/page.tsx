'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardBody, CardFooter } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Textarea } from '@/components/ui/Textarea';
import type { TodoStatus } from '@/types';

interface TodoItem {
  id: string;
  title: string;
  description?: string;
  status: TodoStatus;
  priority?: string;
  assignee?: string;
  due_date?: string;
  created_at: string;
  message?: {
    id: string;
    slack_ts: string;
    text: string;
  };
  workspace?: {
    name: string;
  };
  channel?: {
    name: string;
  };
}

export default function TodosPage() {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [showNewTodoForm, setShowNewTodoForm] = useState(false);
  const [newTodo, setNewTodo] = useState({ title: '', description: '', priority: 'medium' });
  const [expandedTodo, setExpandedTodo] = useState<string | null>(null);

  useEffect(() => {
    fetchTodos();
  }, []);

  const fetchTodos = async () => {
    setIsLoading(true);
    setError('');

    try {
      const response = await fetch('/api/todos');
      if (!response.ok) {
        throw new Error('Failed to fetch TODOs');
      }

      const data = await response.json();
      setTodos(data.todos || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateTodo = async () => {
    try {
      const response = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTodo),
      });

      if (response.ok) {
        const data = await response.json();
        setTodos([...todos, data.todo]);
        setNewTodo({ title: '', description: '', priority: 'medium' });
        setShowNewTodoForm(false);
      }
    } catch (err) {
      console.error('Failed to create TODO:', err);
    }
  };

  const handleMoveStatus = async (todoId: string, newStatus: TodoStatus) => {
    try {
      const response = await fetch(`/api/todos/${todoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (response.ok) {
        setTodos(todos.map(t => t.id === todoId ? { ...t, status: newStatus } : t));
      }
    } catch (err) {
      console.error('Failed to update TODO:', err);
    }
  };

  const getPriorityBadge = (priority?: string) => {
    switch (priority) {
      case 'high': return <Badge variant="error">High</Badge>;
      case 'medium': return <Badge variant="warning">Medium</Badge>;
      case 'low': return <Badge variant="info">Low</Badge>;
      default: return null;
    }
  };

  const getStatusTodos = (status: TodoStatus) => {
    return todos.filter(t => t.status === status);
  };

  const renderTodoCard = (todo: TodoItem) => {
    const isExpanded = expandedTodo === todo.id;

    return (
      <Card key={todo.id} className="mb-3">
        <CardHeader>
          <div className="flex items-start justify-between">
            <h3 className="font-semibold text-sm">{todo.title}</h3>
            {getPriorityBadge(todo.priority)}
          </div>
        </CardHeader>

        {(isExpanded || todo.description) && (
          <CardBody className="text-sm text-gray-700">
            <p>{todo.description}</p>

            {isExpanded && (
              <div className="mt-3 space-y-2 text-xs text-gray-600">
                {todo.assignee && <p>Assignee: {todo.assignee}</p>}
                {todo.due_date && <p>Due: {new Date(todo.due_date).toLocaleDateString()}</p>}
                {todo.workspace && (
                  <p>
                    Source: {todo.workspace.name}
                    {todo.channel && ` / #${todo.channel.name}`}
                  </p>
                )}
                {todo.message && (
                  <a
                    href={`/threads/${todo.message.id}`}
                    className="text-blue-600 hover:underline"
                  >
                    View source message
                  </a>
                )}
              </div>
            )}
          </CardBody>
        )}

        <CardFooter className="flex justify-between items-center">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setExpandedTodo(isExpanded ? null : todo.id)}
          >
            {isExpanded ? 'Collapse' : 'Expand'}
          </Button>

          <div className="flex gap-1">
            {todo.status !== 'open' && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleMoveStatus(todo.id, 'open')}
              >
                Open
              </Button>
            )}
            {todo.status !== 'doing' && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleMoveStatus(todo.id, 'doing')}
              >
                In Progress
              </Button>
            )}
            {todo.status !== 'done' && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleMoveStatus(todo.id, 'done')}
              >
                Done
              </Button>
            )}
          </div>
        </CardFooter>
      </Card>
    );
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">TODOs</h1>
          <p className="text-gray-600 mt-1">Track tasks extracted from Slack messages</p>
        </div>
        <Button onClick={() => setShowNewTodoForm(true)}>Add TODO</Button>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md text-red-700">
          {error}
        </div>
      )}

      {showNewTodoForm && (
        <Card className="mb-6">
          <CardHeader>
            <h3 className="text-lg font-semibold">New TODO</h3>
          </CardHeader>
          <CardBody className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
              <input
                type="text"
                value={newTodo.title}
                onChange={(e) => setNewTodo({ ...newTodo, title: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="What needs to be done?"
              />
            </div>
            <Textarea
              label="Description"
              value={newTodo.description}
              onChange={(e) => setNewTodo({ ...newTodo, description: e.target.value })}
              rows={3}
              placeholder="Add details..."
            />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
              <select
                value={newTodo.priority}
                onChange={(e) => setNewTodo({ ...newTodo, priority: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </CardBody>
          <CardFooter className="flex gap-2">
            <Button onClick={handleCreateTodo} disabled={!newTodo.title}>
              Create
            </Button>
            <Button variant="ghost" onClick={() => setShowNewTodoForm(false)}>
              Cancel
            </Button>
          </CardFooter>
        </Card>
      )}

      {isLoading ? (
        <div className="text-center py-12">
          <p className="text-gray-600">Loading TODOs...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Open Column */}
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Open</h2>
              <Badge variant="default">{getStatusTodos('open').length}</Badge>
            </div>
            <div className="space-y-3">
              {getStatusTodos('open').length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-8">No open tasks</p>
              ) : (
                getStatusTodos('open').map(renderTodoCard)
              )}
            </div>
          </div>

          {/* In Progress Column */}
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">In Progress</h2>
              <Badge variant="info">{getStatusTodos('doing').length}</Badge>
            </div>
            <div className="space-y-3">
              {getStatusTodos('doing').length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-8">No tasks in progress</p>
              ) : (
                getStatusTodos('doing').map(renderTodoCard)
              )}
            </div>
          </div>

          {/* Done Column */}
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Done</h2>
              <Badge variant="success">{getStatusTodos('done').length}</Badge>
            </div>
            <div className="space-y-3">
              {getStatusTodos('done').length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-8">No completed tasks</p>
              ) : (
                getStatusTodos('done').map(renderTodoCard)
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
