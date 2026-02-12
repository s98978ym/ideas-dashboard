---
description: "Manual LLM workflow for analyzing Slack messages without API keys - copy/paste bridge to Claude, ChatGPT, or Gemini"
disable-model-invocation: true
arguments:
  - name: recipe_slug
    description: "Recipe to use for analysis (e.g., 'summary', 'idea_extraction')"
    required: false
  - name: provider
    description: "LLM provider to use: 'claude', 'chatgpt', or 'gemini'"
    required: false
---

# LLM Manual Bridge Workflow

## Purpose

This skill documents the manual copy/paste workflow for analyzing Slack messages using LLMs when API keys are not configured. Users select messages, generate a prompt, copy it to an LLM UI, and paste the response back for parsing.

## Workflow Overview

```
1. User selects messages + recipe
2. System generates prompt with JSON schema
3. User copies prompt
4. User pastes into LLM UI (claude.ai, chatgpt.com, gemini.google.com)
5. LLM responds with JSON
6. User copies response
7. User pastes back into app
8. System validates and parses JSON
9. Display results / create draft
```

## Steps

### 1. Generate Prompt

**File**: `app/api/analysis/generate-prompt/route.ts`

```typescript
export async function POST(request: Request) {
  const { messageIds, recipeSlug, userInput, workspaceId } = await request.json();

  // Fetch messages
  const messages = await prisma.slackMessage.findMany({
    where: {
      id: { in: messageIds },
      workspaceId: workspaceId,
    },
    include: {
      user: true,
      channel: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  // Fetch recipe
  const recipe = await prisma.recipe.findFirst({
    where: {
      slug: recipeSlug,
      OR: [
        { workspaceId: workspaceId },
        { workspaceId: null }, // Built-in recipes
      ],
    },
    orderBy: { version: 'desc' }, // Latest version
  });

  if (!recipe) {
    return Response.json({ error: 'Recipe not found' }, { status: 404 });
  }

  // Format messages for prompt
  const formattedMessages = messages.map(m =>
    `[${m.user.realName || m.user.username}]: ${m.text}`
  ).join('\n');

  // Replace template variables
  let prompt = recipe.promptTemplate;
  prompt = prompt.replace('{{messages}}', formattedMessages);
  if (userInput) {
    prompt = prompt.replace('{{user_input}}', userInput);
  }

  // Add JSON schema instruction
  prompt += `\n\nIMPORTANT: Respond ONLY with valid JSON matching this schema:\n${JSON.stringify(recipe.outputSchema, null, 2)}`;
  prompt += `\n\nDo not include any explanation, markdown formatting, or code blocks. Only output the raw JSON.`;

  return Response.json({
    prompt,
    recipeId: recipe.id,
    messageIds,
  });
}
```

### 2. Display Prompt in UI

**File**: `components/PromptDisplay.tsx`

```typescript
'use client';

import { useState } from 'react';

export function PromptDisplay({ prompt, onPaste }: {
  prompt: string;
  onPaste: (response: string) => void;
}) {
  const [response, setResponse] = useState('');
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      {/* Prompt */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <h3 className="font-semibold">Step 1: Copy this prompt</h3>
          <button
            onClick={handleCopy}
            className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            {copied ? 'Copied!' : 'Copy Prompt'}
          </button>
        </div>
        <pre className="bg-gray-100 p-4 rounded overflow-auto max-h-96 text-sm">
          {prompt}
        </pre>
      </div>

      {/* Provider Links */}
      <div>
        <h3 className="font-semibold mb-2">Step 2: Paste into an LLM</h3>
        <div className="flex gap-2">
          <a
            href="https://claude.ai/new"
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700"
          >
            Open Claude
          </a>
          <a
            href="https://chatgpt.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
          >
            Open ChatGPT
          </a>
          <a
            href="https://gemini.google.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Open Gemini
          </a>
        </div>
      </div>

      {/* Response Input */}
      <div>
        <h3 className="font-semibold mb-2">Step 3: Paste the response here</h3>
        <textarea
          value={response}
          onChange={(e) => setResponse(e.target.value)}
          placeholder="Paste the LLM's JSON response here..."
          className="w-full h-64 p-3 border rounded font-mono text-sm"
        />
      </div>

      {/* Submit */}
      <button
        onClick={() => onPaste(response)}
        disabled={!response.trim()}
        className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400"
      >
        Parse Response
      </button>
    </div>
  );
}
```

### 3. Provider-Specific Instructions

#### Claude (claude.ai)

```typescript
export const CLAUDE_INSTRUCTIONS = `
1. Open https://claude.ai/new in a new tab
2. Paste the prompt into the chat input
3. Press Enter and wait for Claude's response
4. Copy the entire JSON response (without markdown formatting)
5. Paste it back here

Tips:
- If Claude wraps the JSON in markdown code blocks (\`\`\`json...\`\`\`), remove them
- Copy only the raw JSON object
`;
```

#### ChatGPT (chatgpt.com)

```typescript
export const CHATGPT_INSTRUCTIONS = `
1. Open https://chatgpt.com/ in a new tab
2. Start a new chat
3. Paste the prompt into the message box
4. Press Enter and wait for the response
5. Copy the JSON response (remove markdown if present)
6. Paste it back here

Tips:
- ChatGPT may format JSON in code blocks - remove the \`\`\` markers
- If the response is cut off, ask "continue" to get the rest
`;
```

#### Gemini (gemini.google.com)

```typescript
export const GEMINI_INSTRUCTIONS = `
1. Open https://gemini.google.com/ in a new tab
2. Sign in to your Google account if needed
3. Paste the prompt
4. Press Enter and wait for Gemini's response
5. Copy the JSON response
6. Paste it back here

Tips:
- Gemini may include explanatory text before the JSON - copy only the JSON part
- Look for the opening { and closing } to identify the JSON object
`;
```

### 4. Parse Response

**File**: `app/api/analysis/parse-response/route.ts`

```typescript
import Ajv from 'ajv';

export async function POST(request: Request) {
  const { response, recipeId, messageIds, workspaceId, provider } = await request.json();

  // Fetch recipe for schema validation
  const recipe = await prisma.recipe.findUnique({
    where: { id: recipeId },
  });

  if (!recipe) {
    return Response.json({ error: 'Recipe not found' }, { status: 404 });
  }

  // Clean response (remove markdown code blocks)
  let cleanedResponse = response.trim();

  // Remove markdown code blocks
  cleanedResponse = cleanedResponse.replace(/^```(?:json)?\s*\n/i, '');
  cleanedResponse = cleanedResponse.replace(/\n```\s*$/, '');
  cleanedResponse = cleanedResponse.trim();

  // Try to parse JSON
  let parsed;
  try {
    parsed = JSON.parse(cleanedResponse);
  } catch (error) {
    return Response.json({
      error: 'Invalid JSON',
      details: 'The response is not valid JSON. Please check for syntax errors.',
      response: cleanedResponse,
    }, { status: 400 });
  }

  // Validate against schema
  const ajv = new Ajv();
  const validate = ajv.compile(recipe.outputSchema);
  const valid = validate(parsed);

  if (!valid) {
    return Response.json({
      error: 'Schema validation failed',
      details: validate.errors,
      response: cleanedResponse,
    }, { status: 400 });
  }

  // Store analysis
  const analysis = await prisma.analysis.create({
    data: {
      workspaceId,
      recipeId,
      messageIds,
      prompt: '', // We can store the original prompt here if needed
      provider: provider || 'manual',
      result: parsed,
      rawOutput: response,
      status: 'completed',
    },
  });

  return Response.json({
    success: true,
    analysisId: analysis.id,
    result: parsed,
  });
}
```

### 5. JSON Cleaning Utility

**File**: `lib/clean-llm-response.ts`

```typescript
export function cleanLLMResponse(response: string): string {
  let cleaned = response.trim();

  // Remove markdown code blocks
  cleaned = cleaned.replace(/^```(?:json)?\s*\n/im, '');
  cleaned = cleaned.replace(/\n```\s*$/m, '');

  // Remove leading/trailing whitespace
  cleaned = cleaned.trim();

  // Try to extract JSON if there's text before/after
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    cleaned = jsonMatch[0];
  }

  return cleaned;
}

export function parseAndValidate(
  response: string,
  schema: any
): { success: true; data: any } | { success: false; error: string; details?: any } {
  // Clean response
  const cleaned = cleanLLMResponse(response);

  // Parse JSON
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (error) {
    return {
      success: false,
      error: 'Invalid JSON format',
      details: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  // Validate schema
  const ajv = new Ajv();
  const validate = ajv.compile(schema);
  const valid = validate(parsed);

  if (!valid) {
    return {
      success: false,
      error: 'Response does not match expected schema',
      details: validate.errors,
    };
  }

  return { success: true, data: parsed };
}
```

### 6. Error Handling

```typescript
export function AnalysisErrorDisplay({ error, details, response }: {
  error: string;
  details?: any;
  response?: string;
}) {
  return (
    <div className="bg-red-50 border border-red-200 rounded p-4">
      <h3 className="font-semibold text-red-800 mb-2">Error: {error}</h3>

      {details && (
        <div className="mb-3">
          <p className="text-sm text-red-700 mb-1">Details:</p>
          <pre className="bg-red-100 p-2 rounded text-xs overflow-auto">
            {JSON.stringify(details, null, 2)}
          </pre>
        </div>
      )}

      {response && (
        <div>
          <p className="text-sm text-red-700 mb-1">Raw response:</p>
          <pre className="bg-red-100 p-2 rounded text-xs overflow-auto max-h-40">
            {response}
          </pre>
        </div>
      )}

      <div className="mt-3 text-sm text-red-700">
        <p className="font-semibold mb-1">Common fixes:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>Remove markdown code blocks (```json and ```)</li>
          <li>Ensure the response is only JSON, no explanatory text</li>
          <li>Check for missing commas or brackets</li>
          <li>Verify all required fields are present</li>
        </ul>
      </div>
    </div>
  );
}
```

## Checklist

- [ ] Prompt generation includes complete JSON schema
- [ ] "Respond only with JSON" instruction added to prompt
- [ ] Links to all three LLM providers (claude.ai, chatgpt.com, gemini.google.com)
- [ ] Copy-to-clipboard functionality works
- [ ] Response cleaning removes markdown code blocks
- [ ] JSON parsing has try/catch error handling
- [ ] Schema validation using AJV or similar
- [ ] Clear error messages for invalid JSON
- [ ] Clear error messages for schema mismatches
- [ ] Display validation errors to help user fix response
- [ ] Store both raw output and parsed result
- [ ] Track which provider was used (for analytics)

## Troubleshooting

### LLM Returns Non-JSON

**Symptom**: LLM includes explanatory text before/after JSON

**Example**:
```
Here's the analysis you requested:

{
  "summary": "..."
}

Let me know if you need any changes!
```

**Solution**: Add extraction logic to find JSON object

```typescript
function extractJSON(text: string): string | null {
  // Find first { and last }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');

  if (start === -1 || end === -1) return null;

  return text.substring(start, end + 1);
}
```

### JSON Truncated

**Symptom**: LLM response cuts off mid-JSON

**Example**:
```json
{
  "ideas": [
    {"title": "Idea 1", "description": "..."},
    {"title": "Idea 2", "descrip
```

**Solution**: Provide clear instructions to user

```typescript
if (!cleanedResponse.endsWith('}') && !cleanedResponse.endsWith(']')) {
  return {
    error: 'Response appears truncated',
    hint: 'The JSON is incomplete. Try asking the LLM to "continue" or regenerate the response.',
  };
}
```

### Schema Validation Failures

**Common Issues**:

1. **Missing required field**
```json
// Schema requires "summary"
{ "ideas": [...] }  // ❌ Missing "summary"

// Fix: Update prompt to emphasize required fields
```

2. **Wrong type**
```json
// Schema expects array
{ "ideas": "No ideas found" }  // ❌ Should be array

// Fix: Add examples to prompt
```

3. **Extra fields**
```json
// Schema only allows "summary"
{
  "summary": "...",
  "additional_notes": "..."  // ❌ Not in schema
}

// Fix: Use "additionalProperties: false" in schema or allow it
```

**Better Error Messages**:

```typescript
function formatSchemaError(errors: any[]): string {
  return errors.map(err => {
    if (err.keyword === 'required') {
      return `Missing required field: ${err.params.missingProperty}`;
    }
    if (err.keyword === 'type') {
      return `Field "${err.instancePath}" should be ${err.params.type}`;
    }
    return `${err.instancePath}: ${err.message}`;
  }).join('\n');
}
```

### Provider-Specific Issues

**Claude wrapping in code blocks**:
```typescript
// Claude often returns:
// ```json
// { ... }
// ```

// Solution: Strip code blocks
response = response.replace(/^```(?:json)?\s*\n/im, '');
response = response.replace(/\n```\s*$/m, '');
```

**ChatGPT adding explanations**:
```typescript
// ChatGPT might say:
// "Here's the JSON response: { ... }"

// Solution: Extract JSON specifically
const jsonMatch = response.match(/\{[\s\S]*\}/);
if (jsonMatch) {
  response = jsonMatch[0];
}
```

**Gemini refusing to output raw JSON**:
```typescript
// Sometimes Gemini insists on formatting

// Solution: Emphasize in prompt:
const prompt = `${basePrompt}

CRITICAL: Output ONLY the raw JSON object.
Do not use markdown formatting.
Do not add any explanation.
Start your response with { and end with }`;
```

## Future: API Key Integration Path

When API keys are added, the flow becomes:

```typescript
// Same prompt generation
const { prompt } = await generatePrompt({ messageIds, recipeSlug });

// But call API directly instead of manual copy/paste
const response = await callLLMAPI({
  provider: 'claude', // or chatgpt, gemini
  prompt,
  apiKey: workspace.claudeApiKey, // encrypted in DB
});

// Same parsing and validation
const result = parseAndValidate(response, recipe.outputSchema);
```

This manual bridge workflow allows the app to work immediately without requiring API keys, while maintaining the same data structure for when API integration is added later.
