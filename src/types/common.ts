/**
 * Common types shared across the API.
 */

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cached_tokens?: number;
  reasoning_tokens?: number;
}

export type FinishReason = 'stop' | 'length' | 'content_filter' | 'tool_calls' | null;
