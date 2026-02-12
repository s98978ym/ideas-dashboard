# Architecture

## System Overview

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Slack Events   │────>│  Events Endpoint │────>│   QStash Queue  │
│   (real-time)    │     │  (3s ACK)        │     │   (async)       │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                           │
┌─────────────────┐     ┌──────────────────┐              v
│   Vercel Cron   │────>│  DM Sync Job     │     ┌─────────────────┐
│   (every 15min) │     │  (user token)    │────>│   PostgreSQL    │
└─────────────────┘     └──────────────────┘     │   (messages,    │
                                                  │    channels,    │
┌─────────────────┐     ┌──────────────────┐     │    drafts, etc) │
│   Dashboard UI  │<───>│  Next.js API     │<───>│                 │
│   (React)       │     │  Routes          │     └─────────────────┘
└─────────────────┘     └──────────────────┘
         │
         v
┌─────────────────┐     ┌──────────────────┐
│   LLM UI        │<────│  Prompt Generator│
│ (Claude/GPT/    │     │  (Recipe Engine) │
│  Gemini)        │────>│  JSON Parser     │
└─────────────────┘     └──────────────────┘
```

## Data Flow

### Message Ingestion
1. **Real-time (Events API)**: Slack sends event -> verify signature -> ACK 200 -> enqueue -> process async -> save to DB
2. **Scheduled (DM Sync)**: Cron triggers -> list DM conversations -> fetch history incrementally -> save new messages

### Analysis Flow (Manual Bridge)
1. User selects messages + recipe
2. Service generates LLM prompt with JSON schema
3. User copies prompt to Claude/ChatGPT/Gemini
4. User pastes JSON result back
5. Service validates, parses, and saves (creates TODOs, drafts, etc.)

### Send Flow
1. User creates/edits draft
2. Selects send mode (user/bot/copy)
3. Server validates: checks token availability, DM constraints
4. Sends via Slack API or returns text for copy

## Key Design Decisions

### Single-User Mode
- No multi-user auth system needed
- Basic Auth protects dashboard
- One authenticated user's tokens per workspace
- Simplifies inbox logic (all items are for the single user)

### Dual Token Strategy
- **Bot token (xoxb-)**: Events API, channel operations, bot posting
- **User token (xoxp-)**: DM sync, posting as user, reading DM history
- Both obtained in single OAuth flow

### DM Sync vs Events
- Events API is real-time but unreliable (misses during downtime)
- DM sync is reliable but delayed (15-min interval)
- Both write to same DB with dedup (unique constraint on workspace+channel+ts)
- No conflict: if both try to save same message, unique constraint prevents duplicate

### Manual LLM Bridge
- No API keys required for MVP
- User controls which LLM they use
- JSON schema in prompt ensures structured output
- Future: optional API key integration per provider

## Database Schema (Key Models)
- **Workspace**: Slack team, encrypted tokens, sync settings
- **Channel**: Conversations (channels + DMs), with conversation_type
- **SlackMessage**: All messages, deduped by (workspace, channel, ts)
- **InboxItem**: Messages needing attention, with reason
- **Draft**: Reply drafts with send_mode (user/bot/copy)
- **TodoItem**: Extracted action items
- **Recipe**: Analysis templates (built-in + custom)
- **AnalysisRun**: Recipe execution tracking
- **QueueJob**: Async job tracking

## Security Model
- Tokens encrypted at rest (AES-256-GCM)
- Slack signatures verified on all webhooks
- Basic Auth on dashboard routes
- Webhook endpoints publicly accessible (required by Slack)
- QStash endpoints have their own auth
- No tokens or message content in logs
