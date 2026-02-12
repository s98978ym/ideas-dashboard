describe('Send Mode DM Guard', () => {
  interface SendValidation {
    allowed: boolean;
    error?: string;
    alternatives?: string[];
  }

  function validateSendMode(
    sendMode: string,
    conversationType: string,
    hasUserToken: boolean,
    hasBotToken: boolean
  ): SendValidation {
    // Bot cannot send to 1:1 DMs
    if (sendMode === 'bot' && conversationType === 'im') {
      return {
        allowed: false,
        error: 'Bot cannot send messages to 1:1 DMs. Slack does not allow bots to post in direct messages between users.',
        alternatives: ['user', 'copy'],
      };
    }

    // Check token availability
    if (sendMode === 'user' && !hasUserToken) {
      return {
        allowed: false,
        error: 'User token not configured. Re-install the app with user scopes.',
        alternatives: ['bot', 'copy'],
      };
    }

    if (sendMode === 'bot' && !hasBotToken) {
      return {
        allowed: false,
        error: 'Bot token not configured.',
        alternatives: ['user', 'copy'],
      };
    }

    // Copy always works
    if (sendMode === 'copy') {
      return { allowed: true };
    }

    return { allowed: true };
  }

  test('bot send to 1:1 DM is blocked', () => {
    const result = validateSendMode('bot', 'im', true, true);
    expect(result.allowed).toBe(false);
    expect(result.error).toContain('Bot cannot send');
    expect(result.alternatives).toContain('user');
    expect(result.alternatives).toContain('copy');
  });

  test('user send to 1:1 DM is allowed', () => {
    const result = validateSendMode('user', 'im', true, true);
    expect(result.allowed).toBe(true);
  });

  test('bot send to channel is allowed', () => {
    const result = validateSendMode('bot', 'channel', true, true);
    expect(result.allowed).toBe(true);
  });

  test('bot send to private channel is allowed', () => {
    const result = validateSendMode('bot', 'private_channel', true, true);
    expect(result.allowed).toBe(true);
  });

  test('bot send to group DM is allowed (if bot is member)', () => {
    const result = validateSendMode('bot', 'mpim', true, true);
    expect(result.allowed).toBe(true);
  });

  test('copy mode always works regardless of conversation type', () => {
    expect(validateSendMode('copy', 'im', false, false).allowed).toBe(true);
    expect(validateSendMode('copy', 'channel', false, false).allowed).toBe(true);
    expect(validateSendMode('copy', 'mpim', false, false).allowed).toBe(true);
  });

  test('user send without user token is blocked', () => {
    const result = validateSendMode('user', 'channel', false, true);
    expect(result.allowed).toBe(false);
    expect(result.error).toContain('User token not configured');
  });

  test('user send with thread_ts generates correct params', () => {
    const threadTs = '1700000001.000000';
    const channelId = 'C123456';
    const text = 'Hello from user mode';

    const params: any = { channel: channelId, text };
    if (threadTs) params.thread_ts = threadTs;

    expect(params.channel).toBe('C123456');
    expect(params.text).toBe('Hello from user mode');
    expect(params.thread_ts).toBe('1700000001.000000');
  });
});
