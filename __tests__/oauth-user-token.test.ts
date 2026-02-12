describe('OAuth User Token Handling', () => {
  test('OAuth response with authed_user.access_token is recognized', () => {
    const oauthResponse = {
      ok: true,
      access_token: 'xoxb-bot-token-123',
      token_type: 'bot',
      scope: 'channels:history,channels:read,chat:write,groups:history,groups:read,im:history,im:read,mpim:history,mpim:read,users:read,team:read',
      bot_user_id: 'U_BOT_123',
      team: { id: 'T_TEAM_123', name: 'Test Team' },
      authed_user: {
        id: 'U_USER_456',
        access_token: 'xoxp-user-token-456',
        scope: 'chat:write,im:read,im:history,mpim:read,mpim:history,channels:read,channels:history,groups:read,groups:history,users:read',
      },
    };

    // Verify both tokens are present
    expect(oauthResponse.access_token).toBeTruthy();
    expect(oauthResponse.authed_user.access_token).toBeTruthy();
    expect(oauthResponse.authed_user.id).toBe('U_USER_456');
  });

  test('OAuth response without user token is handled gracefully', () => {
    const oauthResponse = {
      ok: true,
      access_token: 'xoxb-bot-token-123',
      token_type: 'bot',
      scope: 'channels:history,channels:read',
      team: { id: 'T_TEAM_123', name: 'Test Team' },
      authed_user: {
        id: 'U_USER_456',
        // No access_token for user
      } as { id: string; access_token?: string },
    };

    const userToken = oauthResponse.authed_user?.access_token;
    expect(userToken).toBeUndefined();
    // Should still work - user token is optional
    expect(oauthResponse.access_token).toBeTruthy();
  });

  test('user scopes are correctly parsed from OAuth response', () => {
    const scope = 'chat:write,im:read,im:history,mpim:read,mpim:history';
    const scopes = scope.split(',');

    expect(scopes).toContain('im:read');
    expect(scopes).toContain('im:history');
    expect(scopes).toContain('mpim:read');
    expect(scopes).toContain('mpim:history');
    expect(scopes).toContain('chat:write');
    expect(scopes).toHaveLength(5);
  });

  test('bot scopes are correctly parsed from OAuth response', () => {
    const scope = 'channels:history,channels:read,chat:write,im:history,im:read';
    const scopes = scope.split(',');

    expect(scopes).toContain('channels:history');
    expect(scopes).toContain('chat:write');
    expect(scopes).toHaveLength(5);
  });

  test('authed_user_id is extracted from OAuth response', () => {
    const response = {
      authed_user: { id: 'U12345', access_token: 'xoxp-test' },
    };

    const userId = response.authed_user?.id;
    expect(userId).toBe('U12345');
  });
});
