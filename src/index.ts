/**
 * Cocoon TypeScript SDK
 *
 * OpenAI-compatible client for Telegram Cocoon — decentralized GPU network
 * for AI inference on TON blockchain.
 */

// Main client
export { Cocoon } from './client.js';
export type { CocoonOptions } from './client.js';
export type {
  AttestationProvider,
  AttestationContext,
  ClientTlsCredentials,
} from './core/protocol/attestation.js';
export {
  StaticAttestationProvider,
  FileAttestationProvider,
} from './core/protocol/attestation.js';

// Chat types
export type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionChoice,
  ChatCompletionChunkChoice,
  ChatCompletionChunkDelta,
  ChatCompletionCreateParams,
  ChatMessage,
  ChatRole,
} from './types/chat.js';

// Model types
export type { Model, ModelList } from './types/models.js';

// Common types
export type { Usage, FinishReason } from './types/common.js';

// Error classes
export {
  CocoonError,
  ConnectionError,
  ProtocolError,
  APIError,
  AuthenticationError,
  TimeoutError,
} from './core/error.js';

// Streaming
export { Stream } from './core/streaming.js';
