/**
 * TypeScript types and enums for Slack AI Analysis Dashboard
 * These mirror the Prisma schema for type safety across the application
 */

// LLM Provider types
export type LLMProvider = 'claude' | 'chatgpt' | 'gemini';

// Recipe categories
export type RecipeCategory = 'summary' | 'ideas' | 'todos' | 'reply' | 'custom';

// Draft statuses
export type DraftStatus = 'draft' | 'sent' | 'copied';

// Draft sent via methods
export type DraftSentVia = 'bot' | 'user_token' | 'copy';

// TODO item statuses
export type TodoStatus = 'open' | 'doing' | 'done';

// Analysis run statuses
export type AnalysisStatus = 'pending' | 'prompt_copied' | 'result_pasted' | 'parsed' | 'error';

// Queue job statuses
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

// Inbox item reasons
export type InboxReason = 'mention' | 'keyword' | 'rule' | 'related';

// Workspace statuses
export type WorkspaceStatus = 'active' | 'suspended' | 'uninstalled';

/**
 * Slack Event Payload
 * Represents the incoming Slack event structure
 */
export interface SlackEventPayload {
  token?: string;
  team_id: string;
  api_app_id?: string;
  event: {
    type: string;
    event_ts: string;
    user?: string;
    text?: string;
    ts: string;
    channel?: string;
    channel_type?: string;
    thread_ts?: string;
    parent_user_id?: string;
    subtype?: string;
    message?: any;
    previous_message?: any;
    channel_id?: string;
    user_id?: string;
    [key: string]: any;
  };
  type: string;
  event_id: string;
  event_time: number;
  authorizations?: Array<{
    enterprise_id: string | null;
    team_id: string;
    user_id: string;
    is_bot: boolean;
    is_enterprise_install: boolean;
  }>;
  is_ext_shared_channel?: boolean;
  context_team_id?: string;
  context_enterprise_id?: string | null;
}

/**
 * Recipe Variable Definition
 * Defines a variable that can be used in recipe templates
 */
export interface RecipeVariable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'array' | 'object';
  description?: string;
  required?: boolean;
  default?: any;
  options?: Array<{ label: string; value: any }>;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    minLength?: number;
    maxLength?: number;
  };
}

/**
 * Analysis Result
 * Structured output from an analysis run
 */
export interface AnalysisResult {
  type: RecipeCategory;
  data: any;
  metadata?: {
    confidence?: number;
    processing_time_ms?: number;
    tokens_used?: number;
    model?: string;
    [key: string]: any;
  };
  summary?: string;
  items?: Array<{
    id?: string;
    title?: string;
    content?: string;
    [key: string]: any;
  }>;
}

/**
 * Slack Message Author Info
 */
export interface SlackMessageAuthor {
  user_id: string;
  user_name?: string;
  real_name?: string;
  display_name?: string;
  avatar_url?: string;
  is_bot?: boolean;
}

/**
 * Slack Thread Context
 */
export interface SlackThreadContext {
  thread_ts: string;
  reply_count?: number;
  reply_users_count?: number;
  latest_reply?: string;
  parent_message?: {
    ts: string;
    user_id?: string;
    text?: string;
  };
}

/**
 * Queue Job Payload Types
 */
export interface SlackEventProcessPayload {
  event: SlackEventPayload;
  workspace_id: string;
}

export interface SlackBackfillPayload {
  workspace_id: string;
  channel_id: string;
  oldest?: string; // Slack timestamp
  latest?: string; // Slack timestamp
  limit?: number;
}

export interface AnalysisParsePayload {
  analysis_run_id: string;
  auto_execute?: boolean;
}

/**
 * Job Queue Options
 */
export interface EnqueueOptions {
  delay?: number; // Delay in seconds
  maxAttempts?: number;
}

/**
 * Recipe Template Context
 * Variables available when rendering recipe templates
 */
export interface RecipeTemplateContext {
  messages?: Array<{
    ts: string;
    user_name?: string;
    text: string;
    thread_ts?: string;
    is_thread_reply: boolean;
  }>;
  channel?: {
    id: string;
    name: string;
    is_private: boolean;
  };
  workspace?: {
    id: string;
    name: string;
    team_id: string;
  };
  timeframe?: {
    start: Date;
    end: Date;
  };
  user_input?: Record<string, any>;
  [key: string]: any;
}

/**
 * Inbox Item with Relations
 */
export interface InboxItemWithMessage {
  id: string;
  user_id: string;
  reason: InboxReason;
  is_read: boolean;
  is_archived: boolean;
  created_at: Date;
  message: {
    id: string;
    slack_ts: string;
    slack_channel_id: string;
    text: string;
    user_name?: string;
    thread_ts?: string;
    created_at: Date;
  };
}

/**
 * Draft with Relations
 */
export interface DraftWithRelations {
  id: string;
  channel_id: string;
  thread_ts?: string;
  text: string;
  status: DraftStatus;
  sent_via?: DraftSentVia;
  created_at: Date;
  updated_at: Date;
  message?: {
    id: string;
    slack_ts: string;
    text: string;
    user_name?: string;
  };
  analysis_run?: {
    id: string;
    recipe: {
      name: string;
      category: RecipeCategory;
    };
  };
}

/**
 * Error Response
 */
export interface ErrorResponse {
  error: string;
  code?: string;
  details?: any;
  timestamp?: string;
}

/**
 * Success Response
 */
export interface SuccessResponse<T = any> {
  success: true;
  data?: T;
  message?: string;
  timestamp?: string;
}
