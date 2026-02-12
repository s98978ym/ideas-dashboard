# Slack AI Analysis Dashboard

## Overview

The Slack AI Analysis Dashboard is a powerful Next.js application that collects messages from multiple Slack workspaces, enables AI-powered analysis through a manual LLM bridge, and helps you manage drafts and TODOs. This MVP implementation focuses on security, reliability, and extensibility while avoiding the complexity and costs of direct LLM API integration.

## Features

- **Multi-workspace Slack integration** - Connect multiple Slack workspaces via OAuth
- **Real-time message ingestion** - Receive messages via Slack Events API with async processing
- **AI-powered analysis** - Manual LLM bridge (copy prompt / paste result) for cost-effective AI analysis
- **Built-in recipes** - Summary, Idea Extraction, TODO Extraction, Reply Draft generation
- **Draft management** - Create, edit, and send drafts via bot token, user token, or manual copy
- **TODO tracking** - Organize tasks with open/doing/done states
- **Smart inbox** - Filter messages by mentions, keywords, and relevance
- **DM synchronization** - 1:1 and group DMs via periodic sync
- **Send mode selection** - Post as yourself (user token), as bot, or copy to clipboard
- **Single-user mode** - Basic Auth protection
- **DM-aware send guards** - Bot cannot post to 1:1 DMs

## Tech Stack

- **Framework**: Next.js 15 (App Router) + TypeScript
- **Database**: PostgreSQL (Vercel Postgres / Neon / Supabase)
- **ORM**: Prisma
- **Queue**: Upstash QStash for async processing
- **Styling**: Tailwind CSS
- **Slack API**: @slack/web-api

## Quick Start

### Prerequisites

- Node.js 18+
- pnpm (or npm/yarn)
- PostgreSQL database
- Slack App (see setup below)

### Installation

```bash
git clone <repo-url>
cd ideas-dashboard
pnpm install
cp .env.example .env.local
# Edit .env.local with your values
npx prisma generate
npx prisma migrate dev
pnpm dev
```

### Slack App Setup

1. Go to https://api.slack.com/apps and create a new app
2. Add bot scopes:
   - `channels:history`
   - `channels:read`
   - `chat:write`
   - `groups:history`
   - `groups:read`
   - `im:history`
   - `im:read`
   - `mpim:history`
   - `mpim:read`
   - `users:read`
   - `team:read`
3. Add user scopes (optional):
   - `chat:write`
4. Enable Events API and subscribe to bot events:
   - `message.channels`
   - `message.groups`
   - `message.im`
   - `message.mpim`
   - `app_mention`
5. Set Request URL: `https://your-domain/api/slack/events`
6. Set OAuth Redirect URL: `https://your-domain/api/slack/oauth/callback`
7. Add user scopes: `chat:write`, `im:read`, `im:history`, `mpim:read`, `mpim:history`, `channels:read`, `channels:history`, `groups:read`, `groups:history`, `users:read`
8. Both bot and user tokens are obtained in a single OAuth flow
9. Copy Client ID, Client Secret, and Signing Secret to `.env.local`

### Environment Variables

Create a `.env.local` file with the following variables:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/slack_dashboard"

# Slack App Credentials
SLACK_CLIENT_ID="your-client-id"
SLACK_CLIENT_SECRET="your-client-secret"
SLACK_SIGNING_SECRET="your-signing-secret"

# Encryption (generate with: openssl rand -hex 32)
ENCRYPTION_KEY="your-64-char-hex-key"

# QStash (for async processing)
QSTASH_URL="https://qstash.upstash.io/v2/publish"
QSTASH_TOKEN="your-qstash-token"
QSTASH_CURRENT_SIGNING_KEY="your-signing-key"
QSTASH_NEXT_SIGNING_KEY="your-next-signing-key"

# App URL
NEXT_PUBLIC_APP_URL="http://localhost:3000"

# Basic Auth (optional, for single-user protection)
BASIC_AUTH_USER="your-username"
BASIC_AUTH_PASS="your-secure-password"
```

See `.env.example` for all required variables.

| Variable | Required | Description |
|----------|----------|-------------|
| DATABASE_URL | Yes | PostgreSQL connection string |
| SLACK_CLIENT_ID | Yes | Slack app client ID |
| SLACK_CLIENT_SECRET | Yes | Slack app client secret |
| SLACK_SIGNING_SECRET | Yes | Slack app signing secret |
| ENCRYPTION_KEY | Yes | 64-char hex key for token encryption |
| QSTASH_URL | Yes | Upstash QStash publish URL |
| QSTASH_TOKEN | Yes | QStash authentication token |
| QSTASH_CURRENT_SIGNING_KEY | Yes | QStash signature verification key |
| QSTASH_NEXT_SIGNING_KEY | Yes | QStash rotation signing key |
| NEXT_PUBLIC_APP_URL | Yes | Application base URL |
| BASIC_AUTH_USER | No | Basic Auth username (set both to enable) |
| BASIC_AUTH_PASS | No | Basic Auth password |

### Local Development with ngrok

For local development, you'll need to expose your local server to the internet so Slack can send events:

```bash
# Start dev server
pnpm dev

# In another terminal, start ngrok
ngrok http 3000

# Update Slack app Request URL with ngrok URL
# Example: https://abc123.ngrok.io/api/slack/events
```

## Architecture

The application follows a serverless-friendly architecture designed for reliability and scalability:

### Event Flow

1. **Slack Events → API Route (3s response) → QStash Queue → Async Processing → Database**
   - Slack sends events to `/api/slack/events`
   - Route verifies signature and immediately acknowledges (within 3 seconds)
   - Event is queued to QStash for async processing
   - Background job processes event and saves to database

2. **AI Analysis Flow**
   - User selects messages and initiates analysis with a recipe
   - Recipe generates a prompt with message context
   - User copies prompt to their preferred LLM (ChatGPT, Claude, etc.)
   - User pastes LLM result back into the app
   - Service parses JSON result and saves analysis

3. **Draft Sending**
   - Drafts can be sent via bot token (as app)
   - Drafts can be sent via user token (as user, if OAuth granted)
   - Drafts can be copied to clipboard for manual sending

### DM Synchronization

DMs are synced via two complementary mechanisms:
1. **Events API** (real-time): Receives DM events as they happen
2. **Scheduled Sync** (every 15 min): Uses user token to fetch DM history incrementally

Configure DM sync schedule in `vercel.json`:
```json
{ "crons": [{ "path": "/api/sync/dm", "schedule": "*/15 * * * *" }] }
```

Manual trigger:
```bash
curl -X POST https://your-domain/api/sync/dm -H "Authorization: Bearer $QSTASH_TOKEN"
```

### Send Modes

| Mode | Token | Works in Channels | Works in DMs | Appears as |
|------|-------|-------------------|--------------|------------|
| user | xoxp- | Yes | Yes | You |
| bot | xoxb- | Yes (if member) | No (1:1 DM) | Bot |
| copy | N/A | N/A | N/A | Manual paste |

### Single-User Security

Set Basic Auth credentials to protect the dashboard:
```bash
BASIC_AUTH_USER="your-username"
BASIC_AUTH_PASS="your-secure-password"
```
Slack webhook endpoints (`/api/slack/*`) and sync endpoints are excluded from auth.
For additional protection, enable Vercel Authentication (Pro plan).

## Project Structure

```
src/
├── app/
│   ├── (dashboard)/          # Dashboard pages
│   │   ├── inbox/            # Inbox view
│   │   ├── workspaces/       # Workspace management
│   │   ├── recipes/          # Recipe management
│   │   ├── drafts/           # Draft management
│   │   ├── todos/            # TODO management
│   │   └── layout.tsx        # Dashboard layout
│   ├── api/
│   │   ├── slack/            # OAuth, Events API
│   │   ├── recipes/          # Recipe CRUD
│   │   ├── drafts/           # Draft CRUD + send
│   │   ├── todos/            # TODO CRUD
│   │   ├── messages/         # Message listing + inbox
│   │   ├── llm/              # Prompt generation + result parsing
│   │   ├── conversations/    # Unified channel + DM listing
│   │   ├── sync/             # DM sync endpoints
│   │   └── workspaces/       # Workspace + channel management
│   └── page.tsx              # Landing page
├── components/               # React components
├── lib/
│   ├── crypto/               # Token encryption, OAuth state
│   ├── queue/                # Job queue (QStash)
│   ├── recipes/              # Recipe engine + registry
│   ├── slack/                # Slack client, events, backfill, verify
│   │   ├── dm-sync.ts        # DM synchronization logic
│   └── llm/                  # LLM provider abstraction
├── middleware.ts             # Basic Auth protection
├── types/                    # TypeScript types
└── ...
prisma/
├── schema.prisma             # Database schema
├── migrations/               # Database migrations
docs/
├── threat-model.md           # Security threat model
├── security-checklist.md     # Deployment security checklist
├── architecture.md           # System architecture documentation
.claude/skills/               # 8 Claude Code skills for development
__tests__/                    # Unit tests
```

## Security

Security is a top priority for this application, which handles sensitive Slack tokens and messages:

- **Encrypted tokens at rest** - Slack tokens encrypted with AES-256-GCM
- **Request signature verification** - All Slack requests verified with HMAC-SHA256
- **OAuth state parameter validation** - CSRF protection for OAuth flow
- **Secure token storage** - Per-encryption random IVs, authenticated encryption
- **No plaintext secrets** - Environment variables for all sensitive data

See `/home/user/ideas-dashboard/docs/threat-model.md` for the complete threat model and `/home/user/ideas-dashboard/docs/security-checklist.md` for deployment security guidelines.

## Deployment (Vercel)

1. Connect your repository to Vercel
2. Set all environment variables in Vercel project settings
3. Database migrations will run automatically on first deploy
4. Update Slack app URLs with your Vercel production domain
5. Test OAuth flow and event delivery

### Post-Deployment Checklist

- Verify Slack app URLs point to production domain
- Test OAuth installation flow
- Send test message to verify event delivery
- Check QStash dashboard for successful job processing
- Review Vercel logs for any errors

## Testing

Run the test suite:

```bash
pnpm test
```

Tests cover:
- Slack signature verification (HMAC-SHA256)
- Token encryption/decryption (AES-256-GCM)
- Event deduplication logic
- Recipe template interpolation and JSON validation

## Design Decisions

### Manual LLM Bridge

The MVP uses a manual LLM bridge to avoid API costs and complexity. Users paste prompts into their preferred LLM UI (ChatGPT, Claude, Gemini, etc.) and paste results back. This approach:

- Eliminates LLM API costs during early development
- Allows users to choose their preferred LLM
- Simplifies implementation (no API key management)
- Can be enhanced later with optional API key integration

### QStash for Async Processing

Vercel serverless functions have execution time limits (10s on Hobby, 60s on Pro). QStash provides reliable async processing via HTTP callbacks:

- Events acknowledged within 3 seconds to satisfy Slack requirements
- Long-running operations (backfill, analysis) run in background
- Automatic retries with exponential backoff
- Dead letter queue for failed jobs

### Recipe System

Analysis templates are extensible and configurable. Built-in recipes cover common use cases:

- **Summary** - Summarize conversation threads
- **Idea Extraction** - Extract actionable ideas from discussions
- **TODO Extraction** - Identify action items and tasks
- **Reply Draft** - Generate context-aware reply suggestions

Custom recipes can be added via API or database.

### Token Encryption

Slack tokens are never stored in plain text. AES-256-GCM encryption with:

- 256-bit encryption key (from environment variable)
- Per-encryption random 12-byte IV
- Authenticated encryption (prevents tampering)
- Base64 encoding for storage

## Development with Claude Code

This project includes 8 Claude Code skills in `.claude/skills/` to accelerate development:

- `add-recipe` - Add new analysis recipes
- `add-slack-event` - Add new Slack event handlers
- `backfill-messages` - Trigger message backfill for workspace
- `create-api-endpoint` - Generate new API routes
- `debug-oauth` - Debug Slack OAuth flow
- `generate-migration` - Create Prisma migrations
- `setup-env` - Initialize environment configuration
- `test-encryption` - Test token encryption/decryption

Use these skills via Claude Code CLI or IDE integration.

## Roadmap

Future enhancements:

- [ ] Optional LLM API integration (OpenAI, Anthropic, etc.)
- [ ] Advanced inbox filters and smart categorization
- [ ] Scheduled analysis jobs
- [ ] Team collaboration features
- [ ] Analytics dashboard
- [ ] Mobile app
- [ ] Webhooks for external integrations

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For issues, questions, or feature requests, please open an issue on GitHub.

---

Built with Next.js, TypeScript, and Slack API
