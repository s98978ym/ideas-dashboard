# OAuth Scopes Documentation

## Bot Token Scopes (xoxb-)

| Scope | Purpose | Required For |
|-------|---------|-------------|
| channels:history | Read public channel messages | Message ingestion |
| channels:read | List public channels | Channel listing |
| chat:write | Post messages as bot | Bot send mode |
| groups:history | Read private channel messages | Private channel ingestion |
| groups:read | List private channels | Channel listing |
| im:history | Read DM messages (bot) | Event processing |
| im:read | List DM conversations (bot) | Events API |
| mpim:history | Read group DM messages (bot) | Event processing |
| mpim:read | List group DM conversations (bot) | Events API |
| users:read | Read user profiles | Display names |
| team:read | Read team info | Workspace metadata |

## User Token Scopes (xoxp-)

| Scope | Purpose | Required For |
|-------|---------|-------------|
| chat:write | Post messages as user | User send mode |
| im:read | List DM conversations | DM sync - list conversations |
| im:history | Read DM message history | DM sync - fetch messages |
| mpim:read | List group DM conversations | DM sync - list conversations |
| mpim:history | Read group DM history | DM sync - fetch messages |
| channels:read | List channels | Channel enumeration |
| channels:history | Read channel history | Backfill via user token |
| groups:read | List private channels | Private channel enumeration |
| groups:history | Read private channel history | Backfill via user token |
| users:read | Read user profiles | DM participant names |

## Why User Token for DM Sync?

The Events API with bot tokens receives DM events, but:
1. Events can be missed if the service is down
2. Historical DMs before app install are not available via Events
3. User token provides reliable incremental sync via conversations.history

The DM sync runs on a 15-minute schedule, fetching only new messages since last sync.

## Minimal Scope Principle

Each scope is required for a specific feature. If a feature is not used:
- Remove `chat:write` from bot scopes if bot send mode is not needed
- Remove `groups:*` if private channels are not monitored
- User scopes cannot be reduced below the listed set if DM sync is enabled
