/**
 * Recipe Registry
 *
 * Defines recipe system with built-in recipes for Slack message analysis.
 * Recipes are templates that generate prompts for LLMs and define expected output schemas.
 */

export interface RecipeDefinition {
  slug: string;
  name: string;
  description: string;
  category: 'summary' | 'ideas' | 'todos' | 'reply' | 'custom';
  promptTemplate: string; // Handlebars-like {{variable}} syntax
  variables: RecipeVariable[];
  outputSchema: Record<string, unknown>; // JSON Schema
  version: number;
}

export interface RecipeVariable {
  name: string;
  type: 'messages' | 'thread' | 'channel_context' | 'user_input' | 'message';
  required: boolean;
  description: string;
}

/**
 * Built-in recipe: Summary
 * Analyzes multiple messages and provides a concise summary with key insights
 */
const summaryRecipe: RecipeDefinition = {
  slug: 'summary',
  name: 'Conversation Summary',
  description: 'Analyzes Slack messages and provides a concise summary with key topics, sentiment, and action items',
  category: 'summary',
  version: 1,
  variables: [
    {
      name: 'messages',
      type: 'messages',
      required: true,
      description: 'Array of Slack messages to analyze'
    }
  ],
  promptTemplate: `Analyze the following Slack messages and provide a concise summary of the conversation.

{{messages}}

Your task:
1. Provide a clear, concise summary (2-4 sentences) of what was discussed
2. Identify key topics mentioned in the conversation
3. Determine the overall sentiment of the conversation
4. Extract any action items or decisions that were made
5. Count the number of unique participants

IMPORTANT: Respond ONLY with valid JSON matching this exact schema. Do not include any text before or after the JSON.

Required JSON Schema:
{
  "summary": "string - 2-4 sentence summary of the conversation",
  "key_topics": ["array", "of", "strings", "representing", "main", "topics"],
  "sentiment": "positive|neutral|negative|mixed - overall conversation sentiment",
  "action_items": ["array", "of", "strings", "each", "action", "item"],
  "participant_count": "number - count of unique participants"
}

Example output format:
{
  "summary": "The team discussed the upcoming product launch and decided to push the release date by one week to allow more time for testing.",
  "key_topics": ["product launch", "release date", "testing", "timeline"],
  "sentiment": "positive",
  "action_items": ["Update project timeline", "Schedule additional testing sessions", "Notify stakeholders of new date"],
  "participant_count": 5
}`,
  outputSchema: {
    type: 'object',
    required: ['summary', 'key_topics', 'sentiment', 'action_items', 'participant_count'],
    properties: {
      summary: { type: 'string' },
      key_topics: { type: 'array', items: { type: 'string' } },
      sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative', 'mixed'] },
      action_items: { type: 'array', items: { type: 'string' } },
      participant_count: { type: 'number' }
    }
  }
};

/**
 * Built-in recipe: Idea Extraction
 * Extracts actionable ideas and insights from messages
 */
const ideaExtractionRecipe: RecipeDefinition = {
  slug: 'idea_extraction',
  name: 'Idea Extraction',
  description: 'Extracts actionable ideas, insights, and suggestions from Slack messages',
  category: 'ideas',
  version: 1,
  variables: [
    {
      name: 'messages',
      type: 'messages',
      required: true,
      description: 'Array of Slack messages to analyze for ideas'
    }
  ],
  promptTemplate: `Extract actionable ideas and insights from these Slack messages. Look for:
- Feature suggestions and product ideas
- Process improvements
- Problem-solving approaches
- Strategic insights
- Innovation opportunities

{{messages}}

For each idea you identify:
1. Create a clear, descriptive title
2. Write a brief description explaining the idea
3. Reference the source message timestamp
4. Assess confidence level (how clearly the idea was articulated)
5. Add relevant tags for categorization

IMPORTANT: Respond ONLY with valid JSON matching this exact schema. Do not include any text before or after the JSON.

Required JSON Schema:
{
  "ideas": [
    {
      "title": "string - clear, descriptive title of the idea",
      "description": "string - detailed explanation of the idea",
      "source_message_ts": "string - Slack timestamp of the source message",
      "confidence": "high|medium|low - how clearly articulated the idea is",
      "tags": ["array", "of", "relevant", "tags"]
    }
  ]
}

Example output format:
{
  "ideas": [
    {
      "title": "Implement automated testing for API endpoints",
      "description": "Add comprehensive unit and integration tests for all REST API endpoints to catch bugs earlier in the development cycle",
      "source_message_ts": "1234567890.123456",
      "confidence": "high",
      "tags": ["testing", "api", "quality", "automation"]
    },
    {
      "title": "Consider using Redis for session caching",
      "description": "Mentioned as a potential solution to reduce database load during peak hours",
      "source_message_ts": "1234567891.123456",
      "confidence": "medium",
      "tags": ["performance", "caching", "infrastructure"]
    }
  ]
}`,
  outputSchema: {
    type: 'object',
    required: ['ideas'],
    properties: {
      ideas: {
        type: 'array',
        items: {
          type: 'object',
          required: ['title', 'description', 'source_message_ts', 'confidence', 'tags'],
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            source_message_ts: { type: 'string' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            tags: { type: 'array', items: { type: 'string' } }
          }
        }
      }
    }
  }
};

/**
 * Built-in recipe: TODO Extraction
 * Extracts action items, tasks, and TODOs from messages
 */
const todoExtractionRecipe: RecipeDefinition = {
  slug: 'todo_extraction',
  name: 'TODO Extraction',
  description: 'Extracts TODO items, action items, and tasks from Slack messages',
  category: 'todos',
  version: 1,
  variables: [
    {
      name: 'messages',
      type: 'messages',
      required: true,
      description: 'Array of Slack messages to analyze for TODOs'
    }
  ],
  promptTemplate: `Extract TODO items, action items, and tasks from these Slack messages. Look for:
- Explicit TODOs and action items
- Assigned tasks and responsibilities
- Commitments and promises
- Follow-up items
- Deadlines and due dates

{{messages}}

For each TODO item:
1. Create a clear, actionable title
2. Provide context in the description
3. Identify assignee if mentioned (use Slack username or name)
4. Extract due date if mentioned
5. Assess priority based on urgency and importance
6. Reference the source message timestamp

IMPORTANT: Respond ONLY with valid JSON matching this exact schema. Do not include any text before or after the JSON.

Required JSON Schema:
{
  "todos": [
    {
      "title": "string - clear, actionable task title",
      "description": "string - context and details about the task",
      "assignee": "string|null - person assigned (if mentioned)",
      "due_date": "string|null - ISO 8601 date format YYYY-MM-DD (if mentioned)",
      "priority": "high|medium|low - assessed priority",
      "source_message_ts": "string - Slack timestamp of the source message"
    }
  ]
}

Example output format:
{
  "todos": [
    {
      "title": "Update documentation for API v2",
      "description": "Complete documentation updates for the new API version before the release",
      "assignee": "@john",
      "due_date": "2026-02-20",
      "priority": "high",
      "source_message_ts": "1234567890.123456"
    },
    {
      "title": "Review pull request #234",
      "description": "Code review needed for the authentication refactor",
      "assignee": "@sarah",
      "due_date": null,
      "priority": "medium",
      "source_message_ts": "1234567891.123456"
    }
  ]
}`,
  outputSchema: {
    type: 'object',
    required: ['todos'],
    properties: {
      todos: {
        type: 'array',
        items: {
          type: 'object',
          required: ['title', 'description', 'priority', 'source_message_ts'],
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            assignee: { type: ['string', 'null'] },
            due_date: { type: ['string', 'null'] },
            priority: { type: 'string', enum: ['high', 'medium', 'low'] },
            source_message_ts: { type: 'string' }
          }
        }
      }
    }
  }
};

/**
 * Built-in recipe: Reply Draft
 * Generates draft replies to Slack messages considering thread context
 */
const replyDraftRecipe: RecipeDefinition = {
  slug: 'reply_draft',
  name: 'Reply Draft',
  description: 'Drafts a reply to a Slack message considering thread context and tone',
  category: 'reply',
  version: 1,
  variables: [
    {
      name: 'message',
      type: 'message',
      required: true,
      description: 'The message to reply to'
    },
    {
      name: 'thread',
      type: 'thread',
      required: false,
      description: 'Thread context (previous messages in the thread)'
    },
    {
      name: 'user_input',
      type: 'user_input',
      required: false,
      description: 'Optional guidance on what to include in the reply'
    }
  ],
  promptTemplate: `Draft a reply to this Slack message. Consider the thread context and maintain an appropriate tone.

MESSAGE TO REPLY TO:
{{message}}

{{#if thread}}
THREAD CONTEXT:
{{thread}}
{{/if}}

{{#if user_input}}
GUIDANCE:
{{user_input}}
{{/if}}

Your task:
1. Draft a professional, helpful reply
2. Identify the appropriate tone for the response
3. Provide 2-3 alternative reply options with different approaches

Guidelines:
- Be concise but thorough
- Match the communication style of the conversation
- Address the key points raised
- Be professional and respectful
- If it's a question, provide a clear answer
- If it's a request, acknowledge and respond appropriately

IMPORTANT: Respond ONLY with valid JSON matching this exact schema. Do not include any text before or after the JSON.

Required JSON Schema:
{
  "reply": "string - the primary recommended reply",
  "tone": "string - the tone of the reply (e.g., professional, friendly, helpful, formal)",
  "alternative_replies": ["string", "string", "string"] - array of 2-3 alternative reply options
}

Example output format:
{
  "reply": "Thanks for raising this issue. I've reviewed the logs and it looks like the API timeout is set too low for this endpoint. I'll increase it to 30 seconds and deploy the fix by end of day.",
  "tone": "professional, helpful",
  "alternative_replies": [
    "Good catch! The timeout issue is on my radar. I'll push a fix today that increases the limit to 30s. Should resolve the problem.",
    "I see the issue - the API timeout needs adjustment. Let me update the configuration and get this deployed ASAP. I'll ping you once it's live."
  ]
}`,
  outputSchema: {
    type: 'object',
    required: ['reply', 'tone', 'alternative_replies'],
    properties: {
      reply: { type: 'string' },
      tone: { type: 'string' },
      alternative_replies: {
        type: 'array',
        items: { type: 'string' },
        minItems: 2,
        maxItems: 3
      }
    }
  }
};

/**
 * Built-in recipe: DM Reply Draft
 * Generates draft replies for direct message conversations
 */
const dmReplyRecipe: RecipeDefinition = {
  slug: 'dm_reply',
  name: 'DM Reply Draft',
  description: 'Draft a reply to a direct message conversation, considering recent context and tone',
  category: 'reply',
  version: 1,
  variables: [
    {
      name: 'messages',
      type: 'messages',
      required: true,
      description: 'Recent DM messages for context'
    },
    {
      name: 'recipient_name',
      type: 'user_input',
      required: true,
      description: 'Name of the person you are replying to'
    },
    {
      name: 'user_input',
      type: 'user_input',
      required: false,
      description: 'Optional guidance on what you want to say'
    }
  ],
  promptTemplate: `You are helping draft a reply in a Slack direct message conversation.

## Recent conversation (most recent messages):
{{messages}}

## The person you are replying to: {{recipient_name}}

## Your intent / what you want to say (optional guidance):
{{user_input}}

## Instructions:
- Draft a natural, conversational reply appropriate for a direct message
- Match the tone of the existing conversation (formal/casual/technical)
- Keep it concise - DMs should be brief and direct
- If the user provided intent, incorporate it naturally
- Provide 2-3 alternative phrasings

IMPORTANT: Respond ONLY with valid JSON matching this exact schema. Do not include any text before or after the JSON.

{
  "reply": "string - the primary suggested reply",
  "tone": "string - detected tone (casual/formal/technical/friendly)",
  "alternative_replies": ["string - alternative phrasing 1", "string - alternative phrasing 2"],
  "context_notes": "string - brief note about the conversation context that informed the reply"
}`,
  outputSchema: {
    type: 'object',
    required: ['reply', 'tone', 'alternative_replies'],
    properties: {
      reply: { type: 'string' },
      tone: { type: 'string' },
      alternative_replies: { type: 'array', items: { type: 'string' } },
      context_notes: { type: 'string' }
    }
  }
};

/**
 * Registry of all built-in recipes
 */
export const BUILTIN_RECIPES: RecipeDefinition[] = [
  summaryRecipe,
  ideaExtractionRecipe,
  todoExtractionRecipe,
  replyDraftRecipe,
  dmReplyRecipe
];

/**
 * Get a recipe by slug from built-in recipes
 */
export function getBuiltinRecipe(slug: string): RecipeDefinition | undefined {
  return BUILTIN_RECIPES.find(recipe => recipe.slug === slug);
}

/**
 * Get all recipes for a specific category
 */
export function getRecipesByCategory(category: RecipeDefinition['category']): RecipeDefinition[] {
  return BUILTIN_RECIPES.filter(recipe => recipe.category === category);
}

/**
 * Validate a recipe definition
 */
export function validateRecipe(recipe: Partial<RecipeDefinition>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!recipe.slug) errors.push('Recipe slug is required');
  if (!recipe.name) errors.push('Recipe name is required');
  if (!recipe.category) errors.push('Recipe category is required');
  if (!recipe.promptTemplate) errors.push('Recipe prompt template is required');
  if (!recipe.variables || !Array.isArray(recipe.variables)) {
    errors.push('Recipe variables must be an array');
  }
  if (!recipe.outputSchema) errors.push('Recipe output schema is required');

  // Validate slug format (lowercase, hyphens, underscores only)
  if (recipe.slug && !/^[a-z0-9_-]+$/.test(recipe.slug)) {
    errors.push('Recipe slug must contain only lowercase letters, numbers, hyphens, and underscores');
  }

  // Validate category
  const validCategories = ['summary', 'ideas', 'todos', 'reply', 'custom'];
  if (recipe.category && !validCategories.includes(recipe.category)) {
    errors.push(`Recipe category must be one of: ${validCategories.join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
