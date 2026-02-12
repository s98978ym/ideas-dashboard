---
description: "Draft message creation, editing, and sending workflow with bot/user token posting or clipboard copy"
disable-model-invocation: true
arguments:
  - name: draft_id
    description: "Draft ID to send or edit"
    required: false
  - name: send_method
    description: "Send method: 'bot', 'user_token', or 'clipboard'"
    required: false
---

# Draft and Send Workflow

## Purpose

This skill documents the workflow for creating draft messages (from analysis results or manually), editing them, and sending them back to Slack via bot token, user token, or clipboard copy.

## Workflow Overview

```
1. Create draft (from analysis or manual)
2. Edit draft text (optional)
3. Choose send method:
   - Bot post (appears as bot)
   - User token post (appears as user)
   - Copy to clipboard (manual paste)
4. Execute send
5. Update status (sent/copied)
6. Display confirmation
```

## Steps

### 1. Create Draft from Analysis

**File**: `app/api/drafts/from-analysis/route.ts`

```typescript
export async function POST(request: Request) {
  const { analysisId, channelId, threadTs } = await request.json();

  // Fetch analysis
  const analysis = await prisma.analysis.findUnique({
    where: { id: analysisId },
    include: { recipe: true }
  });

  if (!analysis) {
    return Response.json({ error: 'Analysis not found' }, { status: 404 });
  }

  // Extract draft text from result
  let draftText = '';

  if (analysis.recipe.category === 'draft') {
    // Reply draft recipe has "reply" field
    draftText = analysis.result.reply;
  } else {
    // For other recipes, format result as text
    draftText = JSON.stringify(analysis.result, null, 2);
  }

  // Create draft
  const draft = await prisma.draft.create({
    data: {
      workspaceId: analysis.workspaceId,
      analysisId: analysis.id,
      channelId,
      threadTs: threadTs || null,
      text: draftText,
      status: 'draft',
    }
  });

  return Response.json(draft);
}
```

### 2. Create Manual Draft

**File**: `app/api/drafts/route.ts`

```typescript
export async function POST(request: Request) {
  const { workspaceId, channelId, threadTs, text } = await request.json();

  const draft = await prisma.draft.create({
    data: {
      workspaceId,
      channelId,
      threadTs: threadTs || null,
      text,
      status: 'draft',
    }
  });

  return Response.json(draft);
}
```

### 3. Edit Draft

**File**: `app/api/drafts/[id]/route.ts`

```typescript
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { text } = await request.json();

  const draft = await prisma.draft.update({
    where: { id: params.id },
    data: { text }
  });

  return Response.json(draft);
}
```

### 4. Send via Bot Token

**File**: `app/api/drafts/[id]/send-bot/route.ts`

```typescript
import { WebClient } from '@slack/web-api';
import { decrypt } from '@/lib/encryption';

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const draft = await prisma.draft.findUnique({
    where: { id: params.id },
    include: { workspace: true }
  });

  if (!draft) {
    return Response.json({ error: 'Draft not found' }, { status: 404 });
  }

  // Decrypt bot token
  const botToken = decrypt(
    draft.workspace.botToken,
    draft.workspace.botTokenIv
  );

  const client = new WebClient(botToken);

  try {
    // Post message
    const result = await client.chat.postMessage({
      channel: draft.channelId,
      text: draft.text,
      thread_ts: draft.threadTs || undefined,
    });

    // Update draft status
    await prisma.draft.update({
      where: { id: draft.id },
      data: {
        status: 'sent',
        sentAt: new Date(),
        sentMethod: 'bot',
      }
    });

    return Response.json({
      success: true,
      messageTs: result.ts,
    });
  } catch (error: any) {
    console.error('Failed to send message:', error);

    return Response.json({
      error: 'Failed to send message',
      details: error.data?.error || error.message,
    }, { status: 500 });
  }
}
```

### 5. Send via User Token

**File**: `app/api/drafts/[id]/send-user/route.ts`

```typescript
import { WebClient } from '@slack/web-api';
import { decrypt } from '@/lib/encryption';

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const draft = await prisma.draft.findUnique({
    where: { id: params.id },
    include: { workspace: true }
  });

  if (!draft) {
    return Response.json({ error: 'Draft not found' }, { status: 404 });
  }

  // Check if user token exists
  if (!draft.workspace.userToken) {
    return Response.json({
      error: 'User token not configured',
      hint: 'Complete user OAuth flow to enable posting as yourself'
    }, { status: 400 });
  }

  // Decrypt user token
  const userToken = decrypt(
    draft.workspace.userToken,
    draft.workspace.userTokenIv!
  );

  const client = new WebClient(userToken);

  try {
    // Post message as user
    const result = await client.chat.postMessage({
      channel: draft.channelId,
      text: draft.text,
      thread_ts: draft.threadTs || undefined,
    });

    // Update draft status
    await prisma.draft.update({
      where: { id: draft.id },
      data: {
        status: 'sent',
        sentAt: new Date(),
        sentMethod: 'user_token',
      }
    });

    return Response.json({
      success: true,
      messageTs: result.ts,
    });
  } catch (error: any) {
    console.error('Failed to send message:', error);

    return Response.json({
      error: 'Failed to send message',
      details: error.data?.error || error.message,
    }, { status: 500 });
  }
}
```

### 6. Copy to Clipboard

**Component**: `components/DraftEditor.tsx`

```typescript
'use client';

import { useState } from 'react';

export function DraftEditor({ draft }: { draft: any }) {
  const [text, setText] = useState(draft.text);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);

    // Mark as copied
    await fetch(`/api/drafts/${draft.id}/mark-copied`, {
      method: 'POST'
    });

    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendBot = async () => {
    const response = await fetch(`/api/drafts/${draft.id}/send-bot`, {
      method: 'POST'
    });

    if (response.ok) {
      alert('Message sent!');
    } else {
      const error = await response.json();
      alert(`Error: ${error.error}`);
    }
  };

  const handleSendUser = async () => {
    const response = await fetch(`/api/drafts/${draft.id}/send-user`, {
      method: 'POST'
    });

    if (response.ok) {
      alert('Message sent as you!');
    } else {
      const error = await response.json();
      alert(`Error: ${error.error}`);
    }
  };

  return (
    <div className="space-y-4">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full h-64 p-3 border rounded"
      />

      <div className="flex gap-2">
        <button
          onClick={handleSendBot}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Send as Bot
        </button>

        <button
          onClick={handleSendUser}
          className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700"
        >
          Send as Me
        </button>

        <button
          onClick={handleCopy}
          className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
        >
          {copied ? 'Copied!' : 'Copy to Clipboard'}
        </button>
      </div>
    </div>
  );
}
```

### 7. Mark as Copied

**File**: `app/api/drafts/[id]/mark-copied/route.ts`

```typescript
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const draft = await prisma.draft.update({
    where: { id: params.id },
    data: {
      status: 'copied',
      sentMethod: 'clipboard',
    }
  });

  return Response.json(draft);
}
```

## Send Modes

### user (recommended for DMs)
- Posts as the authenticated user using their xoxp- token
- Works in all conversation types: channels, private channels, DMs, group DMs
- Requires user token with chat:write scope
- Message appears as if the user typed it directly in Slack

### bot
- Posts as the Slack app bot using the xoxb- token
- Works in: public channels (where bot is member), private channels (where bot is member), group DMs (where bot is member)
- DOES NOT WORK in: 1:1 DMs between users
- Bot must be invited to the channel/conversation first

### copy
- Does not send via API
- Marks draft as "copied" and returns the text
- User manually pastes into Slack
- Always available as fallback

## DM Send Constraints

### 1:1 DM (conversation_type = 'im')
- Bot send mode: BLOCKED (Slack API restriction)
- UI: "Bot" option is disabled with explanation
- Server: Returns 400 error if bot mode attempted for DM
- Recommended: Use "user" mode or "copy" mode

### Group DM (conversation_type = 'mpim')
- Bot send mode: Only works if bot is a member of the group DM
- If bot is not a member, error "not_in_channel" is returned
- Fallback: Use "user" mode or "copy" mode

### Error Handling
- On send failure, error is saved to draft.last_send_error
- Draft status remains "draft" (not "sent") on failure
- User can retry with a different send mode
- Error message is displayed in the UI with suggested alternatives

### 8. Thread Reply Support

When replying in a thread, preserve the `thread_ts`:

```typescript
// When creating draft from thread message
const parentMessage = await prisma.slackMessage.findUnique({
  where: { id: messageId }
});

const draft = await prisma.draft.create({
  data: {
    workspaceId,
    channelId: parentMessage.channelId,
    threadTs: parentMessage.threadTs || parentMessage.ts, // Use threadTs if exists, else use ts (for parent)
    text: draftText,
    status: 'draft',
  }
});

// When sending
await client.chat.postMessage({
  channel: draft.channelId,
  text: draft.text,
  thread_ts: draft.threadTs, // This makes it a thread reply
});
```

## Status Tracking

### Status Values

- **draft**: Initial state, can be edited
- **sent**: Successfully sent to Slack
- **copied**: Copied to clipboard by user

### Status Updates

```typescript
// After successful send
await prisma.draft.update({
  where: { id: draftId },
  data: {
    status: 'sent',
    sentAt: new Date(),
    sentMethod: 'bot', // or 'user_token'
  }
});

// After clipboard copy
await prisma.draft.update({
  where: { id: draftId },
  data: {
    status: 'copied',
    sentMethod: 'clipboard',
  }
});
```

## Encryption/Decryption

**File**: `lib/encryption.ts`

```typescript
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex'); // 32 bytes

export function encrypt(text: string): { encrypted: string; iv: string; tag: string } {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const tag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
  };
}

export function decrypt(encrypted: string, ivHex: string, tagHex?: string): string {
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);

  if (tagHex) {
    const tag = Buffer.from(tagHex, 'hex');
    decipher.setAuthTag(tag);
  }

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
```

**Note**: For MVP, you might store IV in a separate column. For production, consider storing encrypted data as JSON with IV and tag:

```typescript
// Store
const { encrypted, iv, tag } = encrypt(token);
await prisma.workspace.update({
  where: { id },
  data: {
    botToken: encrypted,
    botTokenIv: iv,
    // If using auth tag for GCM mode, store it too
  }
});

// Retrieve
const token = decrypt(workspace.botToken, workspace.botTokenIv);
```

## Checklist

- [ ] Bot token has `chat:write` scope
- [ ] User token has `chat:write` user scope (for user posting)
- [ ] Draft creation from analysis extracts correct field
- [ ] Draft editing updates text field
- [ ] Thread replies preserve `thread_ts`
- [ ] Bot posting decrypts bot token correctly
- [ ] User posting decrypts user token correctly
- [ ] Clipboard copy updates status to 'copied'
- [ ] Sent drafts update status to 'sent' with timestamp
- [ ] Send method is tracked ('bot', 'user_token', 'clipboard')
- [ ] Error handling for missing scopes
- [ ] Error handling for bot not in channel
- [ ] Rate limiting considered for bulk sends

## Troubleshooting

### Bot Not in Channel

**Symptom**: Error `not_in_channel` when trying to send

**Solution**:
```typescript
try {
  await client.chat.postMessage({ channel, text });
} catch (error: any) {
  if (error.data?.error === 'not_in_channel') {
    return Response.json({
      error: 'Bot not in channel',
      hint: `Invite the bot to the channel first: /invite @YourBot`,
      channelId: channel,
    }, { status: 400 });
  }
  throw error;
}
```

### Missing Scopes

**Symptom**: Error `missing_scope` with required scope name

**Solution**:
```typescript
if (error.data?.error === 'missing_scope') {
  const scope = error.data.needed;
  return Response.json({
    error: 'Missing required scope',
    scope: scope,
    hint: 'Reinstall the app to grant this permission',
  }, { status: 403 });
}
```

### User Token Not Configured

**Symptom**: Trying to send as user but no user token

**Solution**:
```typescript
if (!workspace.userToken) {
  return Response.json({
    error: 'User OAuth not completed',
    hint: 'Complete the user OAuth flow to post as yourself',
    authUrl: `/api/slack/oauth/user/start?workspace=${workspace.id}`,
  }, { status: 400 });
}
```

### Rate Limits

**Symptom**: Error `rate_limited` when sending multiple messages

**Slack Rate Limits**:
- `chat.postMessage`: ~1 per second per channel
- Tier 2 method overall: multiple per second

**Solution**: Implement queue or delay

```typescript
async function sendWithRetry(client: WebClient, params: any, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await client.chat.postMessage(params);
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

### Encryption Key Issues

**Symptom**: Error decrypting tokens

**Common Causes**:
1. `ENCRYPTION_KEY` not set
2. Key is wrong length (needs 32 bytes = 64 hex chars)
3. IV mismatch

**Generate key**:
```bash
# Generate a secure 32-byte key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Validation**:
```typescript
if (!process.env.ENCRYPTION_KEY) {
  throw new Error('ENCRYPTION_KEY not set');
}

const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
if (key.length !== 32) {
  throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex characters)');
}
```

### Thread Reply Not Working

**Symptom**: Message posts to channel instead of thread

**Cause**: `thread_ts` not set or incorrect

**Solution**: Verify thread_ts

```typescript
// When creating draft from thread reply
const message = await prisma.slackMessage.findUnique({
  where: { id: messageId }
});

// If message is already in a thread, use its threadTs
// If message is a parent, use its own ts
const threadTs = message.threadTs || message.ts;

const draft = await prisma.draft.create({
  data: {
    channelId: message.channelId,
    threadTs: threadTs,
    text: draftText,
  }
});
```

### User vs Bot Confusion

**Issue**: Users don't understand when message appears as bot vs user

**Solution**: Clear UI labeling

```typescript
<div className="space-y-2">
  <button onClick={handleSendBot}>
    <div className="font-semibold">Send as Bot</div>
    <div className="text-sm text-gray-600">
      Will appear as "AI Analysis" bot
    </div>
  </button>

  <button onClick={handleSendUser}>
    <div className="font-semibold">Send as Me</div>
    <div className="text-sm text-gray-600">
      Will appear with your name
    </div>
  </button>
</div>
```
