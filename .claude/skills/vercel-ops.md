---
description: "Guide for deploying and operating the Slack AI Dashboard on Vercel, including environment setup, QStash configuration, and local development"
disable-model-invocation: true
arguments:
  - name: domain
    description: "Production domain for Slack Request URL configuration"
    required: false
---

# Vercel Operations

## Purpose
Configure and deploy the Slack AI Analysis Dashboard on Vercel with all required services.

## Environment Variables

Set these in Vercel Dashboard > Project Settings > Environment Variables:

| Variable | Required | Description |
|----------|----------|-------------|
| DATABASE_URL | Yes | PostgreSQL connection string (Vercel Postgres, Neon, or Supabase) |
| SLACK_CLIENT_ID | Yes | From Slack App settings |
| SLACK_CLIENT_SECRET | Yes | From Slack App settings |
| SLACK_SIGNING_SECRET | Yes | From Slack App settings |
| TOKEN_ENCRYPTION_KEY | Yes | 64-char hex string: `openssl rand -hex 32` |
| QSTASH_TOKEN | Yes | From Upstash Console |
| QSTASH_CURRENT_SIGNING_KEY | Yes | From Upstash QStash dashboard |
| QSTASH_NEXT_SIGNING_KEY | Yes | From Upstash QStash dashboard |
| NEXT_PUBLIC_APP_URL | Yes | Your deployment URL (e.g., https://your-app.vercel.app) |

## Database Setup

### Option A: Vercel Postgres
1. Go to Vercel Dashboard > Storage > Create Database > Postgres
2. Link to your project - DATABASE_URL is auto-populated
3. Run migrations: `npx prisma migrate deploy`

### Option B: Neon
1. Create database at neon.tech
2. Copy connection string to DATABASE_URL
3. Enable connection pooling for serverless

### Option C: Supabase
1. Create project at supabase.com
2. Go to Settings > Database > Connection string
3. Use "Transaction" mode connection pooler for serverless

## QStash Setup
1. Create account at upstash.com
2. Go to QStash dashboard
3. Copy token and signing keys to environment variables
4. QStash will call: `{NEXT_PUBLIC_APP_URL}/api/slack/events/process`

## Local Development

```bash
# Install dependencies
pnpm install

# Set up environment
cp .env.example .env.local
# Fill in all values in .env.local

# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate dev

# Start dev server
pnpm dev

# For Slack events locally, use ngrok:
ngrok http 3000
# Then set Slack Request URL to: https://your-ngrok.ngrok-free.app/api/slack/events
```

## Slack Request URL Configuration
- Events API: `https://{domain}/api/slack/events`
- OAuth Redirect: `https://{domain}/api/slack/oauth/callback`

## Build & Deploy
- Build command: `next build` (default)
- Output directory: `.next` (default)
- Node.js version: 18.x or 20.x
- Framework preset: Next.js (auto-detected)

## Steps
1. Create Vercel project and link repository
2. Set all environment variables
3. Set up database (Vercel Postgres recommended)
4. Deploy and note the production URL
5. Configure Slack app Request URL with production URL
6. Run `npx prisma migrate deploy` via Vercel CLI or build script
7. Test OAuth flow and event reception

## Checklist
- [ ] All environment variables set in Vercel dashboard
- [ ] Database created and connected
- [ ] Prisma migrations applied
- [ ] QStash configured with correct endpoint URL
- [ ] Slack Request URL updated to production domain
- [ ] OAuth Redirect URL updated to production domain
- [ ] Build succeeds on Vercel
- [ ] Health check: events endpoint responds to url_verification

## Troubleshooting

### Cold start timeouts
Vercel serverless functions have a 10s default timeout (25s on Pro). If Slack events processing takes too long, ensure you're using the async queue pattern (respond 200 immediately, process via QStash).

### Database connection pool exhaustion
Use connection pooling (PgBouncer). Vercel Postgres and Neon have built-in pooling. Set `?pgbouncer=true` in connection string if needed.

### QStash delivery failures
- Check QStash dashboard for failed deliveries
- Verify the endpoint URL is publicly accessible
- Check QStash signing key verification in the process endpoint
- QStash retries automatically with exponential backoff

### Slack URL verification fails
- Ensure the events endpoint returns the challenge value
- Check that signature verification is not blocking the verification request
- Verify SLACK_SIGNING_SECRET is correctly set
