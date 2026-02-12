---
description: "Guide for creating and configuring a Slack App with required scopes, events, and OAuth settings"
disable-model-invocation: true
arguments:
  - name: app_name
    description: "Name for the Slack app (e.g., 'AI Analysis Dashboard')"
    required: false
  - name: request_url
    description: "Your deployment URL for Slack events (e.g., https://your-domain.vercel.app/api/slack/events)"
    required: false
---

# Slack App Setup

## Purpose

This skill guides you through creating and configuring a Slack App for the AI Analysis Dashboard. You'll set up the necessary OAuth scopes, event subscriptions, and configuration to allow the app to read messages and post responses.

## Steps

### 1. Create a New Slack App

1. Go to https://api.slack.com/apps
2. Click "Create New App"
3. Select "From an app manifest"
4. Choose your workspace
5. Paste the manifest below (replace `YOUR_DOMAIN` with your actual deployment URL)

### 2. App Manifest

```yaml
display_information:
  name: AI Analysis Dashboard
  description: Analyze Slack conversations with AI-powered insights
  background_color: "#2c2d30"
features:
  bot_user:
    display_name: AI Analysis
    always_online: true
oauth_config:
  redirect_urls:
    - https://YOUR_DOMAIN/api/slack/oauth/callback
  scopes:
    bot:
      - channels:history
      - channels:read
      - chat:write
      - groups:history
      - groups:read
      - im:history
      - im:read
      - mpim:history
      - mpim:read
      - users:read
      - team:read
    user:
      - chat:write
settings:
  event_subscriptions:
    request_url: https://YOUR_DOMAIN/api/slack/events
    bot_events:
      - message.channels
      - message.groups
      - message.im
      - message.mpim
      - app_mention
  interactivity:
    is_enabled: false
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

### 3. Required Bot Scopes Explained

- **channels:history** - Read messages from public channels
- **channels:read** - View basic info about public channels
- **chat:write** - Send messages as the bot
- **groups:history** - Read messages from private channels
- **groups:read** - View basic info about private channels
- **im:history** - Read direct messages
- **im:read** - View basic info about DMs
- **mpim:history** - Read messages from group DMs
- **mpim:read** - View basic info about group DMs
- **users:read** - Access user profile information
- **team:read** - Access workspace information

## User Token Scopes (for DM sync and user-mode posting)

The following user scopes are requested during OAuth to enable DM synchronization and posting as the authenticated user:

- `chat:write` - Post messages as the user
- `im:read` - List DM conversations
- `im:history` - Read DM message history
- `mpim:read` - List group DM conversations
- `mpim:history` - Read group DM message history
- `channels:read` - List channels (user context)
- `channels:history` - Read channel history (user context)
- `groups:read` - List private channels (user context)
- `groups:history` - Read private channel history (user context)
- `users:read` - Read user profiles

### Re-installation
If user token scopes need to be updated:
1. Go to Workspace Settings in the dashboard
2. Click "Re-install" to re-authorize with updated scopes
3. Both bot and user tokens will be refreshed
4. Existing data is preserved

### DM Considerations
- 1:1 DMs (im): Between two users. Bot cannot post here.
- Group DMs (mpim): Multi-party DMs. Bot can post if it's a member.
- DM sync uses the user token, not the bot token
- Events API also receives DM events for real-time updates

### 4. Optional User Scopes

- **chat:write** - Allow sending messages as the user (not bot) after user OAuth

### 5. Event Subscriptions

The app subscribes to these events:
- **message.channels** - Messages in public channels
- **message.groups** - Messages in private channels
- **message.im** - Direct messages
- **message.mpim** - Group direct messages
- **app_mention** - When the bot is @mentioned

### 6. OAuth Redirect URL Configuration

Set the OAuth redirect URL to:
```
https://YOUR_DOMAIN/api/slack/oauth/callback
```

This URL handles the OAuth flow after a user installs the app.

### 7. Get Your Credentials

After creating the app:

1. Go to "Basic Information"
2. Copy the **Signing Secret** → Add to `.env` as `SLACK_SIGNING_SECRET`
3. Go to "OAuth & Permissions"
4. Copy the **Bot User OAuth Token** → Add to `.env` as `SLACK_BOT_TOKEN` (after installation)
5. Copy the **Client ID** → Add to `.env` as `SLACK_CLIENT_ID`
6. Copy the **Client Secret** → Add to `.env` as `SLACK_CLIENT_SECRET`

### 8. Install to Workspace

1. Go to "Install App" in the sidebar
2. Click "Install to Workspace"
3. Review permissions and click "Allow"
4. Copy the **Bot User OAuth Token** that appears
5. Add it to your `.env` file

### 9. Update Request URL (If Not Using Manifest)

If you didn't use the manifest or need to update the URL:

1. Go to "Event Subscriptions"
2. Toggle "Enable Events" to On
3. Enter your Request URL: `https://YOUR_DOMAIN/api/slack/events`
4. Slack will verify the URL (your endpoint must respond to the challenge)
5. Add the bot events listed above
6. Click "Save Changes"

## Checklist

- [ ] Slack app created at api.slack.com/apps
- [ ] All required bot scopes added (10 scopes total)
- [ ] Optional user scope `chat:write` added (for user-token posting)
- [ ] Event subscriptions enabled with request URL configured
- [ ] All 5 message events subscribed (message.channels, message.groups, message.im, message.mpim, app_mention)
- [ ] OAuth redirect URL configured with `/api/slack/oauth/callback`
- [ ] Signing Secret copied to environment variables
- [ ] Client ID and Client Secret copied to environment variables
- [ ] App installed to workspace
- [ ] Bot User OAuth Token copied to environment variables
- [ ] Event URL verification successful (shows ✓ in Slack app settings)

## Troubleshooting

### OAuth Errors

**Error: `redirect_uri_mismatch`**
- Verify the redirect URL in your Slack app settings exactly matches your deployment URL
- Ensure you're using HTTPS (required for production)
- Check for trailing slashes - `https://domain.com/path` vs `https://domain.com/path/`

**Error: `invalid_client_id`**
- Double-check `SLACK_CLIENT_ID` in your environment variables
- Ensure there are no extra spaces or newlines when copying

**Error: `invalid_code`**
- OAuth codes expire quickly - don't reuse them
- Ensure your server's clock is synchronized

### Event Delivery Failures

**Events not arriving**
- Check the request URL is correct and accessible from the internet
- Verify your endpoint responds with `200 OK` within 3 seconds
- Check "Event Subscriptions" page for retry attempts and error logs
- Use ngrok for local development: `ngrok http 3000`

**URL verification fails**
- Your `/api/slack/events` endpoint must respond to the challenge:
  ```javascript
  if (body.type === 'url_verification') {
    return new Response(JSON.stringify({ challenge: body.challenge }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  ```
- Check server logs for errors during verification
- Ensure the endpoint is publicly accessible

**Duplicate events**
- Slack retries events if not acknowledged within 3 seconds
- Always respond with 200 OK immediately, then process async
- Implement event deduplication using `event_id`

### Missing Messages

**Bot doesn't see messages in a channel**
- The bot must be invited to the channel: `/invite @AI Analysis`
- Check that `channels:history` or `groups:history` scope is granted
- For private channels, the bot must be explicitly added

**Historical messages not available**
- Use the backfill flow with `conversations.history` API
- Bot can only read messages from after it was added to the channel (for public channels)
- For private channels, bot can read full history after being added

### Rate Limiting

**Hitting Slack API rate limits**
- Tier 3 methods (like `conversations.history`): 50+ requests per minute
- Tier 2 methods (like `chat.postMessage`): ~1 request per second per channel
- Implement exponential backoff for retries
- Use `Retry-After` header from Slack responses
- Consider message batching for bulk operations

### Scope Issues

**Missing scope error when calling API**
- Go to "OAuth & Permissions" in your Slack app settings
- Add the missing scope
- Reinstall the app to the workspace (existing tokens don't auto-update)
- Update the token in your environment variables

**User scope not available**
- User scopes require user OAuth flow (separate from bot installation)
- Implement `/api/slack/oauth/user` endpoint for user-level authorization
- Store user tokens separately from bot tokens
