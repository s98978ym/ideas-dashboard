/**
 * Recipe Execution Engine
 *
 * Handles prompt generation, variable interpolation, and result parsing
 * for the recipe system.
 */

import { RecipeDefinition } from './registry';
import Ajv from 'ajv';

const ajv = new Ajv({ allErrors: true });

export interface SlackMessageForPrompt {
  user_name: string;
  text: string;
  ts: string;
  thread_ts?: string;
}

/**
 * Generate a prompt by interpolating variables into the recipe template
 *
 * Supports Handlebars-like syntax:
 * - {{variable}} - simple replacement
 * - {{#if variable}}...{{/if}} - conditional blocks
 */
export function generatePrompt(
  recipe: RecipeDefinition,
  variables: Record<string, unknown>
): string {
  let prompt = recipe.promptTemplate;

  // Validate required variables
  const missingVars: string[] = [];
  for (const variable of recipe.variables) {
    if (variable.required && !variables[variable.name]) {
      missingVars.push(variable.name);
    }
  }

  if (missingVars.length > 0) {
    throw new Error(`Missing required variables: ${missingVars.join(', ')}`);
  }

  // Process conditional blocks {{#if variable}}...{{/if}}
  prompt = prompt.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, varName, content) => {
    const value = variables[varName];
    // Include block if variable exists and is truthy
    if (value !== undefined && value !== null && value !== false && value !== '') {
      return content;
    }
    return '';
  });

  // Replace simple variables {{variable}}
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');

    // Format the value based on its type
    let formattedValue: string;
    if (Array.isArray(value)) {
      // For messages array, use formatMessagesForPrompt
      if (key === 'messages' && value.length > 0 && 'user_name' in value[0]) {
        formattedValue = formatMessagesForPrompt(value as SlackMessageForPrompt[]);
      } else {
        formattedValue = JSON.stringify(value, null, 2);
      }
    } else if (typeof value === 'object' && value !== null) {
      // For single message or other objects
      if ('user_name' in value && 'text' in value) {
        formattedValue = formatMessagesForPrompt([value as SlackMessageForPrompt]);
      } else {
        formattedValue = JSON.stringify(value, null, 2);
      }
    } else {
      formattedValue = String(value);
    }

    prompt = prompt.replace(placeholder, formattedValue);
  }

  return prompt.trim();
}

/**
 * Format Slack messages for inclusion in LLM prompts
 * Creates a readable, structured format that provides context to the LLM
 */
export function formatMessagesForPrompt(
  messages: SlackMessageForPrompt[]
): string {
  if (messages.length === 0) {
    return '(No messages provided)';
  }

  const formatted = messages.map((msg, index) => {
    const threadIndicator = msg.thread_ts ? ' [Thread Reply]' : '';
    const timestamp = new Date(parseFloat(msg.ts) * 1000).toISOString();

    return `--- Message ${index + 1}${threadIndicator} ---
From: ${msg.user_name}
Time: ${timestamp}
Timestamp: ${msg.ts}
${msg.thread_ts ? `Thread: ${msg.thread_ts}\n` : ''}
${msg.text}
`;
  });

  return formatted.join('\n');
}

/**
 * Parse and validate LLM result against recipe's output schema
 */
export function parseResult(
  recipe: RecipeDefinition,
  rawJson: string
): { success: boolean; data?: unknown; errors?: string[] } {
  // Try to extract JSON from the response
  const extracted = extractJSON(rawJson);

  if (!extracted.success) {
    return {
      success: false,
      errors: extracted.errors || ['Could not find valid JSON in response']
    };
  }

  const jsonData = extracted.data;

  // Validate against schema
  const validate = ajv.compile(recipe.outputSchema);
  const valid = validate(jsonData);

  if (!valid) {
    const errors = validate.errors?.map(err => {
      const path = err.instancePath || 'root';
      return `${path}: ${err.message}`;
    }) || ['Unknown validation error'];

    return {
      success: false,
      errors
    };
  }

  return {
    success: true,
    data: jsonData
  };
}

/**
 * Extract JSON from a string that may contain other text
 * Handles common cases where LLMs add extra text before/after JSON
 */
export function extractJSON(text: string): { success: boolean; data?: unknown; errors?: string[] } {
  // First, try parsing the raw text as JSON
  try {
    const parsed = JSON.parse(text);
    return { success: true, data: parsed };
  } catch {
    // Continue to extraction attempts
  }

  // Try to find JSON between markdown code blocks
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1]);
      return { success: true, data: parsed };
    } catch (e) {
      return {
        success: false,
        errors: [`Found JSON in code block but failed to parse: ${(e as Error).message}`]
      };
    }
  }

  // Try to find JSON object by looking for outermost { }
  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      const parsed = JSON.parse(objectMatch[0]);
      return { success: true, data: parsed };
    } catch (e) {
      return {
        success: false,
        errors: [`Found JSON-like structure but failed to parse: ${(e as Error).message}`]
      };
    }
  }

  // Try to find JSON array by looking for outermost [ ]
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      return { success: true, data: parsed };
    } catch (e) {
      return {
        success: false,
        errors: [`Found JSON array but failed to parse: ${(e as Error).message}`]
      };
    }
  }

  return {
    success: false,
    errors: ['Could not find valid JSON in the response. Please ensure the LLM returned valid JSON.']
  };
}

/**
 * Interpolate a single variable into a template string
 * Helper function for simple cases
 */
export function interpolateVariable(template: string, key: string, value: string): string {
  const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
  return template.replace(placeholder, value);
}

/**
 * Validate that all required variables are present
 */
export function validateVariables(
  recipe: RecipeDefinition,
  variables: Record<string, unknown>
): { valid: boolean; missing: string[] } {
  const missing = recipe.variables
    .filter(v => v.required)
    .filter(v => !(v.name in variables) || variables[v.name] === undefined || variables[v.name] === null)
    .map(v => v.name);

  return {
    valid: missing.length === 0,
    missing
  };
}

/**
 * Get variable type from recipe definition
 */
export function getVariableType(
  recipe: RecipeDefinition,
  variableName: string
): RecipeDefinition['variables'][0]['type'] | undefined {
  const variable = recipe.variables.find(v => v.name === variableName);
  return variable?.type;
}
