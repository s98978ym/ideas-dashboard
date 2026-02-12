---
description: "Guide for configuring and operating DM synchronization, including incremental history fetch, deduplication, and troubleshooting"
disable-model-invocation: true
arguments:
  - name: workspace_id
    description: "Workspace ID to sync DMs for (optional, syncs all if omitted)"
    required: false
  - name: force
    description: "Force full resync ignoring last_backfill_ts"
    required: false
---

# DM Synchronization

## Purpose
Synchronize direct messages (1:1 IM and group DM/MPIM) from Slack using the user token. This supplements the Events API which may miss messages during downtime.

## Architecture

```
Vercel Cron (every 15min)
  -> POST /api/sync/dm
    -> For each active workspace with user token:
      -> conversations.list(types=im,mpim) via user token
      -> For each DM conversation:
        -> Upsert Channel record (conversation_type=im|mpim)
        -> conversations.history(oldest=last_backfill_ts)
        -> Save new messages (skip duplicates via unique constraint)
        -> Update last_backfill_ts
      -> Update workspace.last_dm_sync_at
```

## Prerequisites
- User token (xoxp-) with scopes: im:read, im:history, mpim:read, mpim:history
- Workspace.dm_sync_enabled = true
- Workspace.encrypted_user_token is set

## Steps

### Initial Setup
1. Ensure OAuth includes user scopes: im:read, im:history, mpim:read, mpim:history
2. Connect workspace via OAuth (user must authorize)
3. Verify user token is saved (check Workspace Settings page)
4. DM sync is enabled by default for new installations

### Manual Trigger
```bash
# Sync all workspaces
curl -X POST https://your-domain/api/sync/dm \
  -H "Authorization: Bearer $QSTASH_TOKEN"

# Sync specific workspace
curl -X POST https://your-domain/api/sync/dm/WORKSPACE_ID
```

### Cron Setup (Vercel)
Add to vercel.json:
```json
{
  "crons": [
    { "path": "/api/sync/dm", "schedule": "*/15 * * * *" }
  ]
}
```

### QStash Alternative
```bash
curl -X POST https://qstash.upstash.io/v2/schedules \
  -H "Authorization: Bearer $QSTASH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "destination": "https://your-domain/api/sync/dm",
    "cron": "*/15 * * * *"
  }'
```

## Incremental Sync Logic
1. For each conversation, store `last_backfill_ts` (latest message ts seen)
2. On next sync, pass `oldest=last_backfill_ts` to conversations.history
3. Only new messages since last sync are fetched
4. Deduplication: unique constraint on (workspace_id, slack_channel_id, slack_ts) prevents duplicates
5. If create fails with unique constraint error, silently skip (idempotent)

## Rate Limiting
- conversations.list: Tier 2 (~20 req/min) - 1.2s delay between pages
- conversations.history: Tier 3 (~50 req/min) - 1.2s delay between pages
- 500ms delay between different conversations
- If rate_limited error, wait 60s and retry

## Error Handling
- Missing user token: skip workspace, log warning
- API error on conversations.list: abort workspace sync, record error
- API error on single conversation: skip conversation, continue with others
- Unique constraint violation: expected (duplicate message), silently skip
- Network timeout: retry up to 3 times with exponential backoff

## Checklist
- [ ] User token has im:read, im:history, mpim:read, mpim:history scopes
- [ ] Workspace.dm_sync_enabled is true
- [ ] Vercel Cron or QStash schedule is configured
- [ ] Rate limiting delays are in place (1.2s between API calls)
- [ ] Unique constraint prevents duplicate messages
- [ ] last_backfill_ts is updated after each conversation sync
- [ ] workspace.last_dm_sync_at is updated after full sync

## Troubleshooting

### No DMs appearing
- Check user token exists: Workspace Settings page
- Check scopes: im:read, im:history required
- Check dm_sync_enabled flag
- Run manual sync and check response for errors

### Missing messages
- Check last_backfill_ts for the DM channel - messages before this timestamp won't be re-fetched
- To force full resync: clear last_backfill_ts for the channel in DB
- Check rate limiting: if sync is interrupted, some conversations may be skipped

### Rate limit errors
- Reduce concurrent syncs (process workspaces sequentially)
- Increase delay between API calls
- Consider reducing sync frequency from 15min to 30min
