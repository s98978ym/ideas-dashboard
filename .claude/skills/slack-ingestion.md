---
description: "Event ingestion pipeline for Slack messages with async processing, deduplication, and backfill support"
disable-model-invocation: true
arguments:
  - name: workspace_id
    description: "Workspace ID for backfill operation"
    required: false
  - name: channel_id
    description: "Channel ID for backfill operation"
    required: false
---

# Slack Event Ingestion

## Purpose

This skill explains the event ingestion pipeline for receiving, processing, and storing Slack messages. It covers real-time event handling, thread completion, deduplication, and historical backfill.

## Architecture Overview

```
Slack Events API
    ↓
POST /api/slack/events
    ↓
Signature Verification (HMAC-SHA256)
    ↓
200 OK Response (< 3 seconds)
    ↓
Enqueue to QueueJob / QStash
    ↓
Async Processing (processSlackEvent)
    ↓
Store in Database (SlackMessage)
    ↓
Thread Completion (if needed)
    ↓
Mark Processed
```

## Steps

### 1. Event Reception and Verification

**File**: `/api/slack/events/route.ts`

```typescript
export async function POST(request: Request) {
  const body = await request.text();
  const timestamp = request.headers.get('x-slack-request-timestamp');
  const signature = request.headers.get('x-slack-signature');

  // Verify signature (prevent replay attacks)
  if (!verifySlackSignature(body, timestamp, signature)) {
    return new Response('Invalid signature', { status: 401 });
  }

  const event = JSON.parse(body);

  // URL verification challenge
  if (event.type === 'url_verification') {
    return Response.json({ challenge: event.challenge });
  }

  // Immediately enqueue and respond (< 3 seconds requirement)
  await enqueueSlackEvent(event);

  return new Response('OK', { status: 200 });
}
```

### 2. Signature Verification

**File**: `lib/slack/verify-signature.ts`

```typescript
import crypto from 'crypto';

export function verifySlackSignature(
  body: string,
  timestamp: string | null,
  signature: string | null
): boolean {
  if (!timestamp || !signature) return false;

  // Prevent replay attacks (5-minute window)
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - parseInt(timestamp)) > 300) {
    return false;
  }

  // Compute expected signature
  const sigBasestring = `v0:${timestamp}:${body}`;
  const mySignature = 'v0=' + crypto
    .createHmac('sha256', process.env.SLACK_SIGNING_SECRET!)
    .update(sigBasestring)
    .digest('hex');

  // Timing-safe comparison
  return crypto.timingSafeEqual(
    Buffer.from(mySignature),
    Buffer.from(signature)
  );
}
```

### 3. Event Enqueueing

**Option A: Database Queue (Simple)**

```typescript
async function enqueueSlackEvent(event: any) {
  await prisma.queueJob.create({
    data: {
      type: 'slack_event',
      payload: event,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
    }
  });
}
```

**Option B: QStash (Recommended)**

```typescript
import { Client } from '@upstash/qstash';

const qstash = new Client({
  token: process.env.QSTASH_TOKEN!,
});

async function enqueueSlackEvent(event: any) {
  await qstash.publishJSON({
    url: `${process.env.APP_URL}/api/workers/slack-event`,
    body: event,
  });
}
```

### 4. Async Event Processing

**File**: `/api/workers/slack-event/route.ts`

```typescript
export async function POST(request: Request) {
  // Verify QStash signature if using QStash
  if (process.env.QSTASH_TOKEN) {
    const isValid = await verifyQStashSignature(request);
    if (!isValid) {
      return new Response('Invalid signature', { status: 401 });
    }
  }

  const event = await request.json();

  try {
    await processSlackEvent(event);
    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('Failed to process event:', error);
    return new Response('Error', { status: 500 });
  }
}
```

### 5. Event Processing Logic

**File**: `lib/slack/process-event.ts`

```typescript
export async function processSlackEvent(event: any) {
  const { type, event: eventData } = event;

  if (type === 'event_callback') {
    const { type: eventType, ...data } = eventData;

    switch (eventType) {
      case 'message':
        await handleMessage(data);
        break;
      case 'app_mention':
        await handleAppMention(data);
        break;
    }
  }
}

async function handleMessage(data: any) {
  const {
    user,
    text,
    ts,
    channel,
    thread_ts,
    team,
    event_id,
  } = data;

  // Deduplication check
  const existing = await prisma.slackMessage.findUnique({
    where: {
      workspaceId_channelId_ts: {
        workspaceId: team,
        channelId: channel,
        ts: ts,
      }
    }
  });

  if (existing) {
    console.log('Duplicate event, skipping:', event_id);
    return;
  }

  // Store message
  const message = await prisma.slackMessage.create({
    data: {
      eventId: event_id,
      workspaceId: team,
      channelId: channel,
      userId: user,
      text: text,
      ts: ts,
      threadTs: thread_ts || null,
      type: 'message',
      raw: data,
    }
  });

  // If this is a thread reply, check if we need to fetch the full thread
  if (thread_ts && thread_ts !== ts) {
    await ensureThreadComplete(team, channel, thread_ts);
  }
}
```

### 6. Thread Completion

When a thread reply arrives, fetch the full thread if not already cached:

```typescript
async function ensureThreadComplete(
  workspaceId: string,
  channelId: string,
  threadTs: string
) {
  // Check if we have the parent message
  const parent = await prisma.slackMessage.findUnique({
    where: {
      workspaceId_channelId_ts: {
        workspaceId,
        channelId,
        ts: threadTs,
      }
    }
  });

  if (!parent) {
    // Fetch the thread from Slack
    await backfillThread(workspaceId, channelId, threadTs);
  }
}

async function backfillThread(
  workspaceId: string,
  channelId: string,
  threadTs: string
) {
  const workspace = await prisma.workspace.findUnique({
    where: { teamId: workspaceId }
  });

  const client = new WebClient(workspace!.botToken);

  const result = await client.conversations.replies({
    channel: channelId,
    ts: threadTs,
  });

  for (const message of result.messages || []) {
    await handleMessage({
      ...message,
      channel: channelId,
      team: workspaceId,
      event_id: `backfill-${message.ts}`,
    });
  }
}
```

### 7. Deduplication Strategy

**Database Unique Constraint**:

```prisma
model SlackMessage {
  id          String   @id @default(cuid())
  eventId     String?
  workspaceId String
  channelId   String
  ts          String
  // ... other fields

  @@unique([workspaceId, channelId, ts])
  @@index([eventId])
}
```

**Application-Level Check**:

```typescript
// Check by event_id first (for recent events)
let existing = await prisma.slackMessage.findUnique({
  where: { eventId: event_id }
});

// Fallback to composite key (for backfilled messages)
if (!existing) {
  existing = await prisma.slackMessage.findUnique({
    where: {
      workspaceId_channelId_ts: {
        workspaceId: team,
        channelId: channel,
        ts: ts,
      }
    }
  });
}
```

### 8. Backfill Flow

**File**: `/api/backfill/route.ts`

```typescript
export async function POST(request: Request) {
  const { workspaceId, channelId } = await request.json();

  const workspace = await prisma.workspace.findUnique({
    where: { teamId: workspaceId }
  });

  const client = new WebClient(workspace!.botToken);

  let cursor: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const result = await client.conversations.history({
      channel: channelId,
      limit: 100,
      cursor: cursor,
    });

    // Process messages
    for (const message of result.messages || []) {
      await handleMessage({
        ...message,
        channel: channelId,
        team: workspaceId,
        event_id: `backfill-${message.ts}`,
      });
    }

    // Update cursor for pagination
    cursor = result.response_metadata?.next_cursor;
    hasMore = !!cursor;

    // Rate limiting: wait 1 second between requests
    if (hasMore) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return Response.json({ success: true });
}
```

### 9. Rate Limiting for Backfill

```typescript
class RateLimiter {
  private queue: Array<() => Promise<any>> = [];
  private processing = false;
  private delayMs: number;

  constructor(requestsPerSecond: number) {
    this.delayMs = 1000 / requestsPerSecond;
  }

  async add<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      this.process();
    });
  }

  private async process() {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;

    while (this.queue.length > 0) {
      const fn = this.queue.shift()!;
      await fn();
      await new Promise(resolve => setTimeout(resolve, this.delayMs));
    }

    this.processing = false;
  }
}

// Usage
const limiter = new RateLimiter(1); // 1 request per second

await limiter.add(() => client.conversations.history({
  channel: channelId,
  cursor: cursor,
}));
```

## Checklist

- [ ] Signature verification implemented with timing-safe comparison
- [ ] Timestamp validation prevents replay attacks (5-minute window)
- [ ] Events acknowledged with 200 OK within 3 seconds
- [ ] Event processing happens asynchronously (queue or QStash)
- [ ] Deduplication works via unique constraint on (workspaceId, channelId, ts)
- [ ] Event ID deduplication for recent events
- [ ] Thread completion logic fetches missing parent messages
- [ ] Backfill supports cursor pagination
- [ ] Rate limiting implemented for backfill (1 req/sec recommended)
- [ ] Backfill resumable (tracks progress or uses cursor)
- [ ] QStash signatures verified on worker endpoints (if using QStash)
- [ ] Error handling with retry logic (exponential backoff)

## Troubleshooting

### Slack Retry Behavior

**Symptom**: Receiving duplicate events

**Cause**: Slack retries events if not acknowledged within 3 seconds

**Solution**:
- Respond with 200 OK immediately, before processing
- Process events asynchronously in a worker
- Implement robust deduplication

### Missing Events

**Symptom**: Some messages not appearing in database

**Possible Causes**:
1. Bot not in channel → Invite bot: `/invite @YourBot`
2. Event subscription not configured → Check "Event Subscriptions" in Slack app settings
3. Processing errors → Check worker logs for exceptions
4. Deduplication false positive → Review unique constraints and event_id logic

**Debugging**:
```typescript
// Add logging to event handler
console.log('Received event:', {
  type: event.type,
  eventType: event.event?.type,
  channel: event.event?.channel,
  ts: event.event?.ts,
});
```

### Rate Limits

**Symptom**: `429 Too Many Requests` from Slack API

**Slack Rate Limits**:
- Tier 1 (web API): 1+ request per second
- Tier 2 (chat.postMessage): ~1 per second per channel
- Tier 3 (conversations.history): 50+ per minute
- Tier 4 (users.list): 20+ per minute

**Solution**:
```typescript
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      if (error.data?.error === 'rate_limited') {
        const retryAfter = parseInt(error.data.retry_after || '1');
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}
```

### Thread Fetch Loops

**Symptom**: Infinite loop when fetching thread

**Cause**: Thread reply processing triggers another thread fetch

**Solution**:
```typescript
// Track in-progress thread fetches
const fetchingThreads = new Set<string>();

async function ensureThreadComplete(workspaceId: string, channelId: string, threadTs: string) {
  const key = `${workspaceId}:${channelId}:${threadTs}`;

  if (fetchingThreads.has(key)) {
    return; // Already fetching
  }

  fetchingThreads.add(key);
  try {
    await backfillThread(workspaceId, channelId, threadTs);
  } finally {
    fetchingThreads.delete(key);
  }
}
```

### QStash Delivery Failures

**Symptom**: Events not processing even though Slack sent them

**Debugging**:
1. Check QStash dashboard for failed deliveries
2. Verify worker endpoint is publicly accessible
3. Check worker logs for errors
4. Ensure QStash signature verification is correct

**QStash Signature Verification**:
```typescript
import { verifySignature } from '@upstash/qstash/nextjs';

export const POST = verifySignature(async (request: Request) => {
  // This handler only runs if signature is valid
  const event = await request.json();
  await processSlackEvent(event);
  return new Response('OK');
});
```

### Database Connection Pool Exhaustion

**Symptom**: `Too many connections` or timeout errors

**Cause**: Each serverless function creates new DB connections

**Solution**:
```typescript
// Use connection pooling
import { PrismaClient } from '@prisma/client';

declare global {
  var prisma: PrismaClient | undefined;
}

export const prisma = global.prisma || new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL + '?pgbouncer=true&connection_limit=1'
    }
  }
});

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}
```
