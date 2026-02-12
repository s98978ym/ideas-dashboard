---
description: "Database schema design, migrations, indexing strategy, and data retention policies"
disable-model-invocation: true
arguments:
  - name: migration_name
    description: "Name for a new migration (e.g., 'add_user_preferences')"
    required: false
---

# Database Schema Management

## Purpose

This skill documents the complete database schema for the Slack AI Analysis Dashboard, including table structures, relationships, indexes, migration workflows, and data retention policies.

## Full Schema

**File**: `prisma/schema.prisma`

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// Workspace (Slack Team)
model Workspace {
  id              String   @id @default(cuid())
  teamId          String   @unique
  teamName        String
  domain          String?

  // Encrypted tokens
  botToken        String   // Encrypted
  botTokenIv      String   // Encryption IV
  userToken       String?  // Encrypted (optional, for user-level posting)
  userTokenIv     String?

  // Installation metadata
  installedBy     String   // User ID who installed
  installedAt     DateTime @default(now())

  // Settings
  retentionDays   Int      @default(90)

  // Relations
  messages        SlackMessage[]
  channels        SlackChannel[]
  users           SlackUser[]
  recipes         Recipe[]
  analyses        Analysis[]
  drafts          Draft[]

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([teamId])
}

// Slack Channel
model SlackChannel {
  id              String   @id @default(cuid())
  workspaceId     String
  channelId       String
  name            String
  isPrivate       Boolean  @default(false)

  workspace       Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  messages        SlackMessage[]

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([workspaceId, channelId])
  @@index([workspaceId])
  @@index([channelId])
}

// Slack User
model SlackUser {
  id              String   @id @default(cuid())
  workspaceId     String
  userId          String
  username        String
  realName        String?
  email           String?
  avatarUrl       String?

  workspace       Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  messages        SlackMessage[]

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([workspaceId, userId])
  @@index([workspaceId])
  @@index([userId])
}

// Slack Message
model SlackMessage {
  id              String   @id @default(cuid())
  eventId         String?  @unique // Slack event_id (for dedup)

  workspaceId     String
  channelId       String
  userId          String

  ts              String   // Slack timestamp (unique per channel)
  threadTs        String?  // Parent message ts (null if not a thread)

  text            String   @db.Text
  type            String   @default("message")

  // Metadata
  raw             Json     // Full Slack event data

  // Relations
  workspace       Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  channel         SlackChannel @relation(fields: [workspaceId, channelId], references: [workspaceId, channelId], onDelete: Cascade)
  user            SlackUser @relation(fields: [workspaceId, userId], references: [workspaceId, userId], onDelete: Cascade)
  analyses        Analysis[]

  createdAt       DateTime @default(now())

  @@unique([workspaceId, channelId, ts]) // Deduplication
  @@index([workspaceId])
  @@index([channelId])
  @@index([threadTs]) // For thread queries
  @@index([createdAt]) // For retention cleanup
  @@index([eventId]) // For event dedup
}

// Analysis Recipe
model Recipe {
  id              String   @id @default(cuid())
  slug            String
  name            String
  category        String   // "summary", "extraction", "draft", "custom"

  workspaceId     String?  // null = built-in, non-null = custom

  promptTemplate  String   @db.Text
  variables       Json     // Array of variable definitions
  outputSchema    Json     // JSON Schema for validation

  version         Int      @default(1)

  workspace       Workspace? @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  analyses        Analysis[]

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([workspaceId, slug, version])
  @@index([workspaceId])
  @@index([slug])
  @@index([category])
}

// Analysis Result
model Analysis {
  id              String   @id @default(cuid())

  workspaceId     String
  recipeId        String

  // Input context
  messageIds      String[] // Array of message IDs analyzed
  userInput       String?  @db.Text // Optional user-provided context

  // LLM interaction
  prompt          String   @db.Text // Generated prompt sent to LLM
  provider        String   // "claude", "chatgpt", "gemini"
  modelName       String?  // "claude-3-opus", etc.

  // Output
  result          Json     // Parsed JSON result
  rawOutput       String?  @db.Text // Raw LLM output (for debugging)

  // Status
  status          String   @default("pending") // pending, completed, failed
  error           String?  @db.Text

  workspace       Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  recipe          Recipe @relation(fields: [recipeId], references: [id], onDelete: Cascade)
  messages        SlackMessage[] @relation(references: [id])
  drafts          Draft[]

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([workspaceId])
  @@index([recipeId])
  @@index([status])
  @@index([createdAt])
}

// Draft Message
model Draft {
  id              String   @id @default(cuid())

  workspaceId     String
  analysisId      String?  // Optional: created from analysis

  channelId       String
  threadTs        String?  // Reply to thread

  text            String   @db.Text

  status          String   @default("draft") // draft, sent, copied
  sentAt          DateTime?
  sentMethod      String?  // "bot", "user_token", "clipboard"

  workspace       Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  analysis        Analysis? @relation(fields: [analysisId], references: [id], onDelete: SetNull)

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([workspaceId])
  @@index([analysisId])
  @@index([status])
  @@index([channelId])
}

// Queue Job (if not using QStash)
model QueueJob {
  id              String   @id @default(cuid())

  type            String   // "slack_event", "backfill", "cleanup"
  payload         Json

  status          String   @default("pending") // pending, processing, completed, failed
  attempts        Int      @default(0)
  maxAttempts     Int      @default(3)

  error           String?  @db.Text
  processedAt     DateTime?

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([status])
  @@index([type])
  @@index([createdAt])
}
```

## Index Strategy

### Lookup Patterns

1. **Workspace queries**: Most queries filter by `workspaceId` first
   - Index on `workspaceId` for all related tables

2. **Message deduplication**:
   - Unique constraint on `(workspaceId, channelId, ts)`
   - Index on `eventId` for recent event dedup

3. **Thread queries**:
   - Index on `threadTs` to fetch all replies in a thread

4. **Inbox/List queries**:
   - Index on `createdAt` for chronological ordering
   - Index on `status` for filtering pending/completed items

5. **Retention cleanup**:
   - Index on `createdAt` for efficient date range deletes

### Composite Indexes

```prisma
// For queries like: WHERE workspaceId = ? AND status = ? ORDER BY createdAt DESC
@@index([workspaceId, status, createdAt])

// For channel message lookups
@@index([workspaceId, channelId, ts])
```

## Migration Workflow

### Development

```bash
# Create a new migration
npx prisma migrate dev --name add_user_preferences

# This will:
# 1. Prompt for migration name
# 2. Create SQL in prisma/migrations/
# 3. Apply to dev database
# 4. Regenerate Prisma Client
```

### Production (Vercel)

```bash
# In CI/CD or manual deploy
npx prisma migrate deploy

# This applies pending migrations without prompting
```

### Reset Database (Development Only)

```bash
# WARNING: Deletes all data
npx prisma migrate reset

# Reapplies all migrations and runs seed
```

## Data Retention

### Configuration

Each workspace has a configurable retention period:

```typescript
// Default: 90 days
const workspace = await prisma.workspace.update({
  where: { teamId: 'T12345' },
  data: { retentionDays: 30 } // Custom retention
});
```

### Cleanup Cron Job

**File**: `app/api/cron/cleanup/route.ts`

```typescript
export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const workspaces = await prisma.workspace.findMany({
    select: { id: true, teamId: true, retentionDays: true }
  });

  for (const workspace of workspaces) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - workspace.retentionDays);

    // Hard delete messages older than retention period
    const deleted = await prisma.slackMessage.deleteMany({
      where: {
        workspaceId: workspace.id,
        createdAt: { lt: cutoffDate }
      }
    });

    console.log(`Deleted ${deleted.count} messages for workspace ${workspace.teamId}`);
  }

  return Response.json({ success: true });
}
```

### Vercel Cron Configuration

**File**: `vercel.json`

```json
{
  "crons": [
    {
      "path": "/api/cron/cleanup",
      "schedule": "0 2 * * *"
    }
  ]
}
```

## Seeding

**File**: `prisma/seed.ts`

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Seed built-in recipes
  const recipes = [
    {
      slug: 'summary',
      name: 'Summarize Conversation',
      category: 'summary',
      promptTemplate: `Summarize the following Slack conversation in 2-3 sentences:

{{messages}}

Respond with JSON: {"summary": "..."}`,
      variables: [
        { name: 'messages', type: 'array', required: true }
      ],
      outputSchema: {
        type: 'object',
        properties: {
          summary: { type: 'string' }
        },
        required: ['summary']
      },
      version: 1,
    },
    {
      slug: 'idea_extraction',
      name: 'Extract Ideas',
      category: 'extraction',
      promptTemplate: `Extract key ideas from this conversation:

{{messages}}

Respond with JSON: {"ideas": [{"title": "...", "description": "..."}]}`,
      variables: [
        { name: 'messages', type: 'array', required: true }
      ],
      outputSchema: {
        type: 'object',
        properties: {
          ideas: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                description: { type: 'string' }
              },
              required: ['title', 'description']
            }
          }
        },
        required: ['ideas']
      },
      version: 1,
    },
    {
      slug: 'todo_extraction',
      name: 'Extract TODOs',
      category: 'extraction',
      promptTemplate: `Extract action items and TODOs from this conversation:

{{messages}}

Respond with JSON: {"todos": [{"task": "...", "assignee": "...", "priority": "high|medium|low"}]}`,
      variables: [
        { name: 'messages', type: 'array', required: true }
      ],
      outputSchema: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                task: { type: 'string' },
                assignee: { type: 'string' },
                priority: { type: 'string', enum: ['high', 'medium', 'low'] }
              },
              required: ['task']
            }
          }
        },
        required: ['todos']
      },
      version: 1,
    },
    {
      slug: 'reply_draft',
      name: 'Draft Reply',
      category: 'draft',
      promptTemplate: `Draft a professional reply to this Slack conversation:

{{messages}}

Context: {{user_input}}

Respond with JSON: {"reply": "..."}`,
      variables: [
        { name: 'messages', type: 'array', required: true },
        { name: 'user_input', type: 'string', required: false }
      ],
      outputSchema: {
        type: 'object',
        properties: {
          reply: { type: 'string' }
        },
        required: ['reply']
      },
      version: 1,
    },
  ];

  for (const recipe of recipes) {
    await prisma.recipe.upsert({
      where: {
        workspaceId_slug_version: {
          workspaceId: null as any, // Built-in recipes have null workspaceId
          slug: recipe.slug,
          version: recipe.version,
        }
      },
      update: recipe,
      create: { ...recipe, workspaceId: null },
    });
  }

  console.log('Seeded built-in recipes');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

## Checklist

- [ ] All tables have appropriate indexes for common queries
- [ ] Unique constraints prevent duplicate data (event dedup, workspace+channel+ts)
- [ ] No cascade deletes without explicit review (use `onDelete: Cascade` carefully)
- [ ] Encrypted columns identified (botToken, userToken) with separate IV columns
- [ ] Foreign key relationships properly defined
- [ ] Indexes on `workspaceId` for all workspace-scoped tables
- [ ] Indexes on `createdAt` for chronological queries and retention cleanup
- [ ] Indexes on `status` fields for filtering pending/completed items
- [ ] Migration files tracked in version control
- [ ] Seed script creates built-in recipes
- [ ] Data retention policy configurable per workspace
- [ ] Cleanup cron job scheduled

## Troubleshooting

### Migration Conflicts

**Symptom**: `Error: Migration XYZ failed to apply`

**Cause**: Database state doesn't match migration expectations

**Solution**:
```bash
# Check current migration status
npx prisma migrate status

# Mark specific migration as applied (if already applied manually)
npx prisma migrate resolve --applied "20240101000000_migration_name"

# Or mark as rolled back
npx prisma migrate resolve --rolled-back "20240101000000_migration_name"
```

### Vercel Postgres Connection Limits

**Symptom**: `too many clients already` or connection timeout

**Cause**: Serverless functions create many concurrent connections

**Solution**:
```typescript
// Use connection pooling in DATABASE_URL
DATABASE_URL="postgresql://user:pass@host/db?pgbouncer=true&connection_limit=1"

// Or use Prisma Data Proxy
// https://www.prisma.io/docs/data-platform/data-proxy
```

### Pool Configuration

**File**: `lib/prisma.ts`

```typescript
import { PrismaClient } from '@prisma/client';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL + '?pgbouncer=true&connection_limit=1'
    }
  },
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
```

### Slow Queries

**Symptom**: API endpoints timing out

**Debugging**:
```bash
# Enable query logging
DATABASE_URL="..." npx prisma studio

# Or in code:
const prisma = new PrismaClient({
  log: ['query'],
});
```

**Common Issues**:
1. Missing index → Add index to frequently filtered columns
2. N+1 queries → Use `include` or `select` to fetch relations
3. Large result sets → Add pagination with `take` and `skip`

**Example Fix**:
```typescript
// Bad: N+1 query
const messages = await prisma.slackMessage.findMany();
for (const msg of messages) {
  const user = await prisma.slackUser.findUnique({ where: { id: msg.userId } });
}

// Good: Single query with include
const messages = await prisma.slackMessage.findMany({
  include: { user: true }
});
```

### Data Integrity Issues

**Symptom**: Orphaned records or constraint violations

**Solution**: Add database-level constraints and use transactions

```typescript
// Use transactions for multi-table operations
await prisma.$transaction([
  prisma.analysis.create({ data: analysisData }),
  prisma.draft.create({ data: draftData }),
]);

// Or with interactive transactions
await prisma.$transaction(async (tx) => {
  const analysis = await tx.analysis.create({ data: analysisData });
  await tx.draft.create({
    data: { ...draftData, analysisId: analysis.id }
  });
});
```
