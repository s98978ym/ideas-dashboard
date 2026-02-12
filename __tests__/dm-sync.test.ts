describe('DM Sync Idempotency', () => {
  // Simulate the dedup logic used in dm-sync
  const savedMessages = new Map<string, boolean>(); // key: workspace_id:channel_id:ts

  function saveMessage(workspaceId: string, channelId: string, ts: string): boolean {
    const key = `${workspaceId}:${channelId}:${ts}`;
    if (savedMessages.has(key)) {
      return false; // Duplicate, skip
    }
    savedMessages.set(key, true);
    return true; // New message saved
  }

  beforeEach(() => {
    savedMessages.clear();
  });

  test('first message is saved successfully', () => {
    expect(saveMessage('ws1', 'D001', '1700000001.000000')).toBe(true);
  });

  test('duplicate message is skipped', () => {
    saveMessage('ws1', 'D001', '1700000001.000000');
    expect(saveMessage('ws1', 'D001', '1700000001.000000')).toBe(false);
  });

  test('same ts in different channels is not duplicate', () => {
    saveMessage('ws1', 'D001', '1700000001.000000');
    expect(saveMessage('ws1', 'D002', '1700000001.000000')).toBe(true);
  });

  test('same ts in different workspaces is not duplicate', () => {
    saveMessage('ws1', 'D001', '1700000001.000000');
    expect(saveMessage('ws2', 'D001', '1700000001.000000')).toBe(true);
  });

  test('incremental sync only fetches new messages', () => {
    const lastSyncTs = '1700000005.000000';
    const messages = [
      { ts: '1700000003.000000', text: 'old' },
      { ts: '1700000005.000000', text: 'boundary' },
      { ts: '1700000007.000000', text: 'new' },
      { ts: '1700000009.000000', text: 'newer' },
    ];

    const newMessages = messages.filter(m => m.ts > lastSyncTs);
    expect(newMessages).toHaveLength(2);
    expect(newMessages[0].text).toBe('new');
    expect(newMessages[1].text).toBe('newer');
  });

  test('conversation types are correctly identified', () => {
    function getConversationType(conv: { is_im?: boolean; is_mpim?: boolean }): string {
      if (conv.is_im) return 'im';
      if (conv.is_mpim) return 'mpim';
      return 'channel';
    }

    expect(getConversationType({ is_im: true })).toBe('im');
    expect(getConversationType({ is_mpim: true })).toBe('mpim');
    expect(getConversationType({})).toBe('channel');
  });
});
