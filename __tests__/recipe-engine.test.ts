describe('Recipe Engine', () => {
  function interpolateTemplate(template: string, variables: Record<string, unknown>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const value = variables[key];
      if (value === undefined) return `{{${key}}}`;
      if (typeof value === 'string') return value;
      return JSON.stringify(value);
    });
  }

  function validateJsonResult(raw: string, requiredFields: string[]): { valid: boolean; data?: any; errors?: string[] } {
    try {
      const data = JSON.parse(raw);
      const errors: string[] = [];
      for (const field of requiredFields) {
        if (!(field in data)) {
          errors.push(`Missing required field: ${field}`);
        }
      }
      return errors.length > 0 ? { valid: false, errors } : { valid: true, data };
    } catch (e) {
      return { valid: false, errors: [`Invalid JSON: ${(e as Error).message}`] };
    }
  }

  test('interpolates simple variables', () => {
    const template = 'Hello {{name}}, you have {{count}} messages';
    const result = interpolateTemplate(template, { name: 'Alice', count: 5 });
    expect(result).toBe('Hello Alice, you have 5 messages');
  });

  test('preserves unknown variables', () => {
    const template = 'Hello {{name}}, {{unknown}} here';
    const result = interpolateTemplate(template, { name: 'Bob' });
    expect(result).toBe('Hello Bob, {{unknown}} here');
  });

  test('handles array/object variables as JSON', () => {
    const template = 'Messages: {{messages}}';
    const messages = [{ text: 'hello' }, { text: 'world' }];
    const result = interpolateTemplate(template, { messages });
    expect(result).toContain('"text":"hello"');
  });

  test('validates correct JSON result', () => {
    const raw = '{"summary":"Test summary","key_topics":["topic1"],"sentiment":"positive"}';
    const result = validateJsonResult(raw, ['summary', 'key_topics', 'sentiment']);
    expect(result.valid).toBe(true);
    expect(result.data.summary).toBe('Test summary');
  });

  test('rejects invalid JSON', () => {
    const raw = 'This is not JSON';
    const result = validateJsonResult(raw, ['summary']);
    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toContain('Invalid JSON');
  });

  test('detects missing fields', () => {
    const raw = '{"summary":"Test"}';
    const result = validateJsonResult(raw, ['summary', 'key_topics', 'sentiment']);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
  });
});
