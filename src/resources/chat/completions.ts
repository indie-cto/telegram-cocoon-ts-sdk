/**
 * Chat Completions resource — the main API for AI inference.
 *
 * Implements both non-streaming and streaming modes:
 * - Non-streaming: collects all queryAnswerPartEx + final queryAnswerEx,
 *   parses the HTTP response body as JSON, returns ChatCompletion.
 * - Streaming: wraps parts in Stream<ChatCompletionChunk>, parses SSE from chunks.
 */

import type { CocoonSession } from '../../core/protocol/session.js';
import { buildHttpRequest } from '../../core/protocol/session.js';
import { deserializeTLObject } from '../../core/tl/deserializer.js';
import { Stream } from '../../core/streaming.js';
import { APIError, ProtocolError } from '../../core/error.js';
import type {
  ChatCompletionCreateParams,
  ChatCompletion,
  ChatCompletionChunk,
} from '../../types/chat.js';
import type { HttpResponse } from '../../core/tl/types.js';

type SessionProvider = () => Promise<CocoonSession>;

export class Completions {
  constructor(private readonly getSession: SessionProvider) {}

  private extractHttpData(answer: Buffer): {
    payload: Buffer;
    statusCode?: number;
    reason?: string;
  } {
    try {
      const httpResponse = deserializeTLObject(answer) as unknown as HttpResponse;
      if (httpResponse._type === 'http.response') {
        return {
          payload: httpResponse.payload,
          statusCode: httpResponse.statusCode,
          reason: httpResponse.reason,
        };
      }
    } catch {
      // Not a boxed http.response TL object, treat as raw payload chunk.
    }
    return { payload: answer };
  }

  private parseErrorPayload(payload: Buffer, fallbackMessage: string): { message: string; body: unknown } {
    if (payload.length === 0) {
      return { message: fallbackMessage, body: { error: fallbackMessage } };
    }
    const text = payload.toString('utf-8');
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const message =
        typeof parsed.message === 'string'
          ? parsed.message
          : typeof parsed.error === 'string'
            ? parsed.error
            : fallbackMessage;
      return { message, body: parsed };
    } catch {
      return { message: text || fallbackMessage, body: { error: text || fallbackMessage } };
    }
  }

  /**
   * Create a chat completion.
   *
   * @param params - OpenAI-compatible chat completion parameters
   * @returns ChatCompletion (non-streaming) or Stream<ChatCompletionChunk> (streaming)
   */
  async create(
    params: ChatCompletionCreateParams & { stream: true },
  ): Promise<Stream<ChatCompletionChunk>>;
  async create(params: ChatCompletionCreateParams & { stream?: false }): Promise<ChatCompletion>;
  async create(
    params: ChatCompletionCreateParams,
  ): Promise<ChatCompletion | Stream<ChatCompletionChunk>>;
  async create(
    params: ChatCompletionCreateParams,
  ): Promise<ChatCompletion | Stream<ChatCompletionChunk>> {
    const session = await this.getSession();

    // Build the JSON body (OpenAI-compatible)
    const body = JSON.stringify({
      model: params.model,
      messages: params.messages,
      stream: params.stream ?? false,
      ...(params.temperature !== undefined && { temperature: params.temperature }),
      ...(params.top_p !== undefined && { top_p: params.top_p }),
      ...(params.max_tokens !== undefined && { max_tokens: params.max_tokens }),
      ...(params.max_completion_tokens !== undefined && {
        max_completion_tokens: params.max_completion_tokens,
      }),
      ...(params.stop !== undefined && { stop: params.stop }),
      ...(params.presence_penalty !== undefined && { presence_penalty: params.presence_penalty }),
      ...(params.frequency_penalty !== undefined && {
        frequency_penalty: params.frequency_penalty,
      }),
    });

    const httpRequest = buildHttpRequest(
      'POST',
      '/v1/chat/completions',
      Buffer.from(body, 'utf-8'),
    );

    if (params.stream) {
      return this.createStreaming(session, params, httpRequest);
    }

    return this.createNonStreaming(session, params, httpRequest);
  }

  private async createNonStreaming(
    session: CocoonSession,
    params: ChatCompletionCreateParams,
    httpRequest: import('../../core/tl/types.js').HttpRequest,
  ): Promise<ChatCompletion> {
    const chunks: Buffer[] = [];
    let sawAnswer = false;
    let statusCode: number | undefined;
    let statusReason: string | undefined;

    const finalAnswer = await session.sendQuery(params.model, httpRequest, {
      maxCoefficient: params.max_coefficient,
      maxTokens: params.max_tokens ?? params.max_completion_tokens,
      timeout: params.timeout,
      onPart: (part) => {
        if (!('answer' in part) || !part.answer) {
          return;
        }
        sawAnswer = true;
        const extracted = this.extractHttpData(part.answer as Buffer);
        if (extracted.statusCode !== undefined) {
          statusCode = extracted.statusCode;
          statusReason = extracted.reason;
        }
        if (extracted.payload.length > 0) {
          chunks.push(extracted.payload);
        }
      },
    });

    if (finalAnswer._type === 'client.queryAnswerErrorEx') {
      throw new APIError(finalAnswer.error, 500, {
        error_code: finalAnswer.errorCode,
        error: finalAnswer.error,
      });
    }

    // Safety fallback in case caller didn't receive chunk callbacks.
    if (!sawAnswer && 'answer' in finalAnswer && finalAnswer.answer) {
      const extracted = this.extractHttpData(finalAnswer.answer as Buffer);
      if (extracted.statusCode !== undefined) {
        statusCode = extracted.statusCode;
        statusReason = extracted.reason;
      }
      if (extracted.payload.length > 0) {
        chunks.push(extracted.payload);
      }
    }

    const fullPayload = Buffer.concat(chunks);
    if (statusCode !== undefined && statusCode >= 400) {
      const fallback = statusReason ? `${statusCode} ${statusReason}` : `HTTP ${statusCode}`;
      const parsed = this.parseErrorPayload(fullPayload, fallback);
      throw new APIError(parsed.message, statusCode, parsed.body);
    }
    if (fullPayload.length === 0) {
      throw new ProtocolError('Empty response from proxy');
    }

    try {
      return JSON.parse(fullPayload.toString('utf-8')) as ChatCompletion;
    } catch (error) {
      throw new ProtocolError(
        `Failed to parse completion payload as JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async createStreaming(
    session: CocoonSession,
    params: ChatCompletionCreateParams,
    httpRequest: import('../../core/tl/types.js').HttpRequest,
  ): Promise<Stream<ChatCompletionChunk>> {
    const stream = new Stream<ChatCompletionChunk>();
    let sseBuffer = '';
    let headersParsed = false;
    let statusCode: number | undefined;
    let statusReason: string | undefined;
    const errorChunks: Buffer[] = [];

    // Process streaming in background
    session
      .sendQuery(params.model, httpRequest, {
        maxCoefficient: params.max_coefficient,
        maxTokens: params.max_tokens ?? params.max_completion_tokens,
        timeout: params.timeout,
        onPart: (part) => {
          try {
            let rawData: Buffer | undefined;

            if ('answer' in part && part.answer) {
              const answer = part.answer as Buffer;

              if (!headersParsed) {
                // First chunk may contain HTTP response headers as TL object
                try {
                  const httpResponse = deserializeTLObject(answer) as unknown as HttpResponse;
                  if (httpResponse._type === 'http.response') {
                    headersParsed = true;
                    statusCode = httpResponse.statusCode;
                    statusReason = httpResponse.reason;
                    rawData = httpResponse.payload;
                  } else {
                    rawData = answer;
                  }
                } catch {
                  // Not a TL object, raw SSE data
                  rawData = answer;
                  headersParsed = true;
                }
              } else {
                rawData = answer;
              }
            }

            if (rawData && rawData.length > 0) {
              if (statusCode !== undefined && statusCode >= 400) {
                errorChunks.push(rawData);
                return;
              }
              sseBuffer += rawData.toString('utf-8');
              this.processSSEBuffer(sseBuffer, stream);
              // Keep unprocessed remainder
              const lastNewline = sseBuffer.lastIndexOf('\n');
              if (lastNewline >= 0) {
                sseBuffer = sseBuffer.substring(lastNewline + 1);
              }
            }
          } catch (e) {
            stream.error(e instanceof Error ? e : new Error(String(e)));
          }
        },
      })
      .then(() => {
        if (statusCode !== undefined && statusCode >= 400) {
          const parsed = this.parseErrorPayload(
            Buffer.concat(errorChunks),
            statusReason ? `${statusCode} ${statusReason}` : `HTTP ${statusCode}`,
          );
          stream.error(new APIError(parsed.message, statusCode, parsed.body));
          return;
        }

        // Process any remaining buffer
        if (sseBuffer.trim().length > 0) {
          this.processSSEBuffer(sseBuffer + '\n', stream);
        }
        stream.end();
      })
      .catch((err) => {
        stream.error(err instanceof Error ? err : new Error(String(err)));
      });

    return stream;
  }

  private processSSEBuffer(buffer: string, stream: Stream<ChatCompletionChunk>): void {
    const lines = buffer.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed === '') continue;
      if (trimmed === 'data: [DONE]') continue;

      if (trimmed.startsWith('data: ')) {
        const jsonStr = trimmed.substring(6);
        try {
          const chunk = JSON.parse(jsonStr) as ChatCompletionChunk;
          stream.push(chunk);
        } catch {
          // Partial JSON, will be completed in next chunk
        }
      }
    }
  }
}
