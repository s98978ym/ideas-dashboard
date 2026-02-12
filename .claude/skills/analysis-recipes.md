---
description: "Recipe system for defining LLM analysis templates with variables, JSON schemas, and versioning"
disable-model-invocation: true
arguments:
  - name: recipe_slug
    description: "Recipe slug to view details (e.g., 'summary', 'idea_extraction')"
    required: false
  - name: category
    description: "Filter recipes by category: 'summary', 'extraction', 'draft', 'custom'"
    required: false
---

# Analysis Recipe System

## Purpose

This skill documents the recipe system for defining reusable LLM analysis templates. Recipes include prompt templates, variable definitions, output schemas, and versioning for iterative improvements.

## Recipe Structure

```typescript
interface Recipe {
  id: string;
  slug: string;              // Unique identifier (e.g., "summary")
  name: string;              // Display name
  category: string;          // "summary" | "extraction" | "draft" | "custom"
  workspaceId: string | null; // null = built-in, non-null = custom
  promptTemplate: string;    // Template with {{variables}}
  variables: Variable[];     // Array of variable definitions
  outputSchema: JSONSchema;  // JSON Schema for validation
  version: number;           // Incremental version number
  createdAt: Date;
  updatedAt: Date;
}

interface Variable {
  name: string;              // Variable name used in template
  type: 'messages' | 'thread' | 'message' | 'channel_context' | 'user_input';
  description?: string;      // Help text for users
  required: boolean;         // Is this variable required?
}
```

## Template Variable Syntax

Variables are referenced in prompt templates using double curly braces:

```
{{variable_name}}
```

### Variable Types

1. **messages** (array): Multiple selected messages
   ```typescript
   // Formatted as:
   [Alice]: Hello everyone
   [Bob]: Hi Alice, how are you?
   [Alice]: Doing great!
   ```

2. **thread** (array): All messages in a thread
   ```typescript
   // Same format as messages, but auto-fetches entire thread
   ```

3. **message** (single): One specific message
   ```typescript
   // Formatted as:
   [Username]: Message text
   ```

4. **channel_context** (metadata): Channel information
   ```typescript
   // Formatted as:
   Channel: #general (public)
   Participants: 5 people
   Time range: 2024-01-15 to 2024-01-16
   ```

5. **user_input** (string): User-provided context
   ```typescript
   // Raw text provided by user when running the recipe
   ```

## Built-in Recipes

### 1. Summary Recipe

```typescript
{
  slug: 'summary',
  name: 'Summarize Conversation',
  category: 'summary',
  promptTemplate: `Summarize the following Slack conversation in 2-3 sentences:

{{messages}}

Respond with JSON: {"summary": "..."}`,
  variables: [
    {
      name: 'messages',
      type: 'messages',
      description: 'Messages to summarize',
      required: true,
    }
  ],
  outputSchema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'A concise summary of the conversation'
      }
    },
    required: ['summary'],
    additionalProperties: false
  },
  version: 1,
}
```

### 2. Idea Extraction Recipe

```typescript
{
  slug: 'idea_extraction',
  name: 'Extract Ideas',
  category: 'extraction',
  promptTemplate: `Extract key ideas and insights from this Slack conversation:

{{messages}}

For each idea, provide:
- A concise title
- A detailed description
- The person who suggested it (if mentioned)

Respond with JSON matching this structure:
{
  "ideas": [
    {
      "title": "Idea title",
      "description": "Detailed description",
      "suggested_by": "Person's name or null"
    }
  ]
}`,
  variables: [
    {
      name: 'messages',
      type: 'messages',
      description: 'Messages to extract ideas from',
      required: true,
    }
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
            description: { type: 'string' },
            suggested_by: { type: ['string', 'null'] }
          },
          required: ['title', 'description'],
          additionalProperties: false
        }
      }
    },
    required: ['ideas'],
    additionalProperties: false
  },
  version: 1,
}
```

### 3. TODO Extraction Recipe

```typescript
{
  slug: 'todo_extraction',
  name: 'Extract Action Items',
  category: 'extraction',
  promptTemplate: `Extract all action items and TODOs from this conversation:

{{messages}}

For each action item, identify:
- The task to be done
- Who it's assigned to (if mentioned)
- Priority level (high/medium/low)
- Any mentioned deadline

Respond with JSON:
{
  "todos": [
    {
      "task": "Task description",
      "assignee": "Person's name or null",
      "priority": "high|medium|low",
      "deadline": "Date or null"
    }
  ]
}`,
  variables: [
    {
      name: 'messages',
      type: 'messages',
      description: 'Messages to extract TODOs from',
      required: true,
    }
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
            assignee: { type: ['string', 'null'] },
            priority: {
              type: 'string',
              enum: ['high', 'medium', 'low']
            },
            deadline: { type: ['string', 'null'] }
          },
          required: ['task', 'priority'],
          additionalProperties: false
        }
      }
    },
    required: ['todos'],
    additionalProperties: false
  },
  version: 1,
}
```

### 4. Reply Draft Recipe

```typescript
{
  slug: 'reply_draft',
  name: 'Draft Reply',
  category: 'draft',
  promptTemplate: `Draft a professional and helpful reply to this Slack conversation:

{{messages}}

Additional context from user:
{{user_input}}

Respond with JSON:
{
  "reply": "Your drafted reply text"
}

The reply should:
- Be professional and friendly
- Address the main points discussed
- Be concise (2-3 paragraphs max)
- Match the tone of the conversation`,
  variables: [
    {
      name: 'messages',
      type: 'messages',
      description: 'Conversation to reply to',
      required: true,
    },
    {
      name: 'user_input',
      type: 'user_input',
      description: 'Additional context or instructions',
      required: false,
    }
  ],
  outputSchema: {
    type: 'object',
    properties: {
      reply: {
        type: 'string',
        description: 'The drafted reply message'
      }
    },
    required: ['reply'],
    additionalProperties: false
  },
  version: 1,
}
```

## Adding Custom Recipes

### API Endpoint

**File**: `app/api/recipes/route.ts`

```typescript
export async function POST(request: Request) {
  const session = await getSession(); // Your auth logic
  const { workspaceId, slug, name, category, promptTemplate, variables, outputSchema } = await request.json();

  // Validate JSON Schema
  try {
    const ajv = new Ajv();
    ajv.compile(outputSchema); // Will throw if invalid
  } catch (error) {
    return Response.json({
      error: 'Invalid JSON Schema',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 400 });
  }

  // Validate template variables
  const templateVars = extractTemplateVariables(promptTemplate);
  const definedVars = variables.map((v: any) => v.name);
  const undefinedVars = templateVars.filter((v: string) => !definedVars.includes(v));

  if (undefinedVars.length > 0) {
    return Response.json({
      error: 'Template contains undefined variables',
      variables: undefinedVars,
    }, { status: 400 });
  }

  // Create recipe
  const recipe = await prisma.recipe.create({
    data: {
      workspaceId,
      slug,
      name,
      category,
      promptTemplate,
      variables,
      outputSchema,
      version: 1,
    }
  });

  return Response.json(recipe);
}

function extractTemplateVariables(template: string): string[] {
  const regex = /\{\{(\w+)\}\}/g;
  const matches = [...template.matchAll(regex)];
  return matches.map(m => m[1]);
}
```

### UI for Creating Recipes

**File**: `components/RecipeEditor.tsx`

```typescript
'use client';

import { useState } from 'react';

export function RecipeEditor() {
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('custom');
  const [promptTemplate, setPromptTemplate] = useState('');
  const [variables, setVariables] = useState<any[]>([]);
  const [outputSchema, setOutputSchema] = useState('{}');

  const addVariable = () => {
    setVariables([...variables, {
      name: '',
      type: 'user_input',
      description: '',
      required: false,
    }]);
  };

  const handleSubmit = async () => {
    // Validate and submit
    try {
      const schema = JSON.parse(outputSchema);

      const response = await fetch('/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          name,
          category,
          promptTemplate,
          variables,
          outputSchema: schema,
        }),
      });

      if (response.ok) {
        alert('Recipe created!');
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      alert('Invalid JSON Schema');
    }
  };

  return (
    <div className="space-y-4">
      <input
        value={slug}
        onChange={(e) => setSlug(e.target.value)}
        placeholder="Slug (e.g., my_recipe)"
        className="w-full p-2 border rounded"
      />

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Display Name"
        className="w-full p-2 border rounded"
      />

      <select
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        className="w-full p-2 border rounded"
      >
        <option value="summary">Summary</option>
        <option value="extraction">Extraction</option>
        <option value="draft">Draft</option>
        <option value="custom">Custom</option>
      </select>

      <div>
        <label className="block mb-1 font-semibold">Prompt Template</label>
        <textarea
          value={promptTemplate}
          onChange={(e) => setPromptTemplate(e.target.value)}
          placeholder="Use {{variable_name}} for variables..."
          className="w-full h-64 p-2 border rounded font-mono text-sm"
        />
      </div>

      <div>
        <div className="flex justify-between items-center mb-2">
          <label className="font-semibold">Variables</label>
          <button
            onClick={addVariable}
            className="px-3 py-1 bg-blue-600 text-white rounded"
          >
            Add Variable
          </button>
        </div>

        {variables.map((v, i) => (
          <div key={i} className="flex gap-2 mb-2">
            <input
              value={v.name}
              onChange={(e) => {
                const newVars = [...variables];
                newVars[i].name = e.target.value;
                setVariables(newVars);
              }}
              placeholder="Variable name"
              className="flex-1 p-2 border rounded"
            />
            <select
              value={v.type}
              onChange={(e) => {
                const newVars = [...variables];
                newVars[i].type = e.target.value;
                setVariables(newVars);
              }}
              className="p-2 border rounded"
            >
              <option value="messages">Messages</option>
              <option value="thread">Thread</option>
              <option value="message">Single Message</option>
              <option value="channel_context">Channel Context</option>
              <option value="user_input">User Input</option>
            </select>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={v.required}
                onChange={(e) => {
                  const newVars = [...variables];
                  newVars[i].required = e.target.checked;
                  setVariables(newVars);
                }}
              />
              Required
            </label>
          </div>
        ))}
      </div>

      <div>
        <label className="block mb-1 font-semibold">Output JSON Schema</label>
        <textarea
          value={outputSchema}
          onChange={(e) => setOutputSchema(e.target.value)}
          placeholder='{"type": "object", "properties": {...}}'
          className="w-full h-48 p-2 border rounded font-mono text-sm"
        />
      </div>

      <button
        onClick={handleSubmit}
        className="px-4 py-2 bg-green-600 text-white rounded"
      >
        Create Recipe
      </button>
    </div>
  );
}
```

## Versioning

### Updating a Recipe

When updating a recipe, increment the version to keep history:

```typescript
export async function PUT(request: Request) {
  const { id, promptTemplate, variables, outputSchema } = await request.json();

  const currentRecipe = await prisma.recipe.findUnique({
    where: { id }
  });

  if (!currentRecipe) {
    return Response.json({ error: 'Recipe not found' }, { status: 404 });
  }

  // Create new version
  const newRecipe = await prisma.recipe.create({
    data: {
      workspaceId: currentRecipe.workspaceId,
      slug: currentRecipe.slug,
      name: currentRecipe.name,
      category: currentRecipe.category,
      promptTemplate,
      variables,
      outputSchema,
      version: currentRecipe.version + 1, // Increment version
    }
  });

  return Response.json(newRecipe);
}
```

### Fetching Latest Version

```typescript
const recipe = await prisma.recipe.findFirst({
  where: {
    slug: 'summary',
    OR: [
      { workspaceId: 'workspace_123' },
      { workspaceId: null }, // Built-in
    ],
  },
  orderBy: { version: 'desc' }, // Get latest version
});
```

## Checklist

- [ ] Template syntax uses `{{variable_name}}` format
- [ ] All template variables defined in variables array
- [ ] Variable types correctly specified (messages, thread, message, channel_context, user_input)
- [ ] Required variables marked appropriately
- [ ] Output schema is valid JSON Schema (validates with AJV)
- [ ] Schema includes `required` array for mandatory fields
- [ ] Schema uses `additionalProperties: false` to prevent extra fields
- [ ] Version incremented when updating existing recipe
- [ ] Built-in recipes have `workspaceId: null`
- [ ] Custom recipes have `workspaceId` set
- [ ] Category is one of: summary, extraction, draft, custom

## Troubleshooting

### Template Syntax Errors

**Symptom**: Variables not being replaced in generated prompt

**Common Issues**:
1. Wrong syntax: `{variable}` instead of `{{variable}}`
2. Typo in variable name: `{{mesages}}` instead of `{{messages}}`
3. Variable not defined in variables array

**Solution**:
```typescript
// Validation function
function validateTemplate(template: string, variables: Variable[]): string[] {
  const usedVars = extractTemplateVariables(template);
  const definedVars = variables.map(v => v.name);

  return usedVars.filter(v => !definedVars.includes(v));
}

// Use before saving
const errors = validateTemplate(promptTemplate, variables);
if (errors.length > 0) {
  throw new Error(`Undefined variables: ${errors.join(', ')}`);
}
```

### Schema Validation Issues

**Symptom**: JSON Schema validation fails on valid data

**Common Issues**:

1. **Missing `type` field**
```json
// ❌ Invalid
{
  "properties": {
    "summary": { "description": "..." }
  }
}

// ✅ Valid
{
  "type": "object",
  "properties": {
    "summary": { "type": "string", "description": "..." }
  }
}
```

2. **Array schema without `items`**
```json
// ❌ Invalid
{
  "type": "object",
  "properties": {
    "ideas": { "type": "array" }
  }
}

// ✅ Valid
{
  "type": "object",
  "properties": {
    "ideas": {
      "type": "array",
      "items": { "type": "object", "properties": {...} }
    }
  }
}
```

3. **Nullable fields**
```json
// ❌ Won't accept null
{ "assignee": { "type": "string" } }

// ✅ Accepts null
{ "assignee": { "type": ["string", "null"] } }
```

### Variable Not Populating

**Symptom**: `{{messages}}` shows as empty string

**Debugging**:
```typescript
// Add logging to variable replacement
function replaceVariables(template: string, values: Record<string, any>): string {
  let result = template;

  for (const [key, value] of Object.entries(values)) {
    const placeholder = `{{${key}}}`;
    console.log(`Replacing ${placeholder} with:`, value);
    result = result.replace(new RegExp(placeholder, 'g'), value);
  }

  return result;
}
```

**Common Causes**:
1. No messages selected
2. Messages not formatted correctly
3. Variable name mismatch

### Version Conflicts

**Symptom**: Creating duplicate slugs with same version

**Solution**: Use unique constraint

```prisma
model Recipe {
  // ...
  @@unique([workspaceId, slug, version])
}
```

Then handle conflict in code:
```typescript
try {
  const recipe = await prisma.recipe.create({ data });
} catch (error) {
  if (error.code === 'P2002') {
    // Unique constraint violation
    return Response.json({
      error: 'Recipe with this slug and version already exists'
    }, { status: 409 });
  }
  throw error;
}
```
