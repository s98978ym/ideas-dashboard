import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { Button } from '@/components/ui/Button';
import { authOptions } from '@/lib/auth/options';

export default async function HomePage() {
  const session = await getServerSession(authOptions);

  if (session) {
    redirect('/inbox');
  }

  // In a real app, check if workspaces exist
  const hasWorkspaces = false;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center px-4">
      <div className="max-w-2xl w-full text-center">
        <h1 className="text-5xl font-bold text-gray-900 mb-4">
          Slack AI Analysis Dashboard
        </h1>

        <p className="text-xl text-gray-700 mb-8">
          Collect, analyze, and act on Slack messages with AI-powered workflows.
          Never miss important conversations, extract insights, manage TODOs, and draft replies.
        </p>

        <div className="space-y-4">
          <div>
            <a href="/api/slack/oauth">
              <Button size="lg" className="text-lg px-8 py-4">
                Connect Workspace
              </Button>
            </a>
          </div>

          {hasWorkspaces && (
            <div>
              <Link href="/inbox">
                <Button variant="secondary" size="lg">
                  Go to Dashboard
                </Button>
              </Link>
            </div>
          )}
        </div>

        <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
          <div className="bg-white p-6 rounded-lg shadow-sm">
            <h3 className="font-semibold text-lg mb-2">Smart Inbox</h3>
            <p className="text-gray-600 text-sm">
              Automatically filter messages that need your attention based on mentions, keywords, and custom rules.
            </p>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-sm">
            <h3 className="font-semibold text-lg mb-2">AI Recipes</h3>
            <p className="text-gray-600 text-sm">
              Run analysis recipes to summarize conversations, extract ideas and TODOs, or draft replies.
            </p>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-sm">
            <h3 className="font-semibold text-lg mb-2">Workflow Management</h3>
            <p className="text-gray-600 text-sm">
              Track drafts, manage TODOs extracted from messages, and keep everything organized.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
