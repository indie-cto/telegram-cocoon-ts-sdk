import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Completions } from '../../src/resources/chat/completions';
import { serializeTLObject } from '../../src/core/tl/serializer';
import { Stream } from '../../src/core/streaming';
import type { CocoonSession } from '../../src/core/protocol/session';
import type { ClientQueryAnswerExType } from '../../src/core/tl/types';

function createMockSession(overrides: Partial<CocoonSession> = {}): CocoonSession {
  return {
    connected: true,
    sendQuery: vi.fn(),
    sendRpcQuery: vi.fn(),
    ...overrides,
  } as unknown as CocoonSession;
}

describe('Completions', () => {
  let mockSession: CocoonSession;
  let completions: Completions;

  beforeEach(() => {
    mockSession = createMockSession();
    completions = new Completions(async () => mockSession);
  });

  describe('non-streaming create', () => {
    it('should return ChatCompletion from successful response', async () => {
      const chatCompletion = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1700000000,
        model: 'test-model',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hello!' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      };

      // Build the TL HTTP response containing the chat completion
      const httpResponse = {
        _type: 'http.response',
        httpVersion: 'HTTP/1.1',
        statusCode: 200,
        reason: 'OK',
        headers: [{ _type: 'http.header', name: 'Content-Type', value: 'application/json' }],
        payload: Buffer.from(JSON.stringify(chatCompletion)),
      };
      const httpResponseBuf = serializeTLObject(httpResponse as unknown as Record<string, unknown>);

      const sendQueryMock = vi.fn(
        async (
          _modelName: string,
          _httpRequest: unknown,
          options?: { onPart?: (part: ClientQueryAnswerExType) => void },
        ) => {
          return {
            _type: 'client.queryAnswerEx' as const,
            requestId: Buffer.alloc(32),
            answer: httpResponseBuf,
            flags: 0,
          } as unknown as ClientQueryAnswerExType;
        },
      );
      mockSession.sendQuery = sendQueryMock;

      const result = await completions.create({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(result.id).toBe('chatcmpl-123');
      expect(result.choices[0]!.message.content).toBe('Hello!');
    });

    it('should throw APIError on queryAnswerErrorEx', async () => {
      const sendQueryMock = vi.fn().mockResolvedValue({
        _type: 'client.queryAnswerErrorEx',
        requestId: Buffer.alloc(32),
        errorCode: 500,
        error: 'Model not found',
        flags: 0,
      });
      mockSession.sendQuery = sendQueryMock;

      await expect(
        completions.create({
          model: 'nonexistent',
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      ).rejects.toThrow('Model not found');
    });

    it('should throw ProtocolError on empty response', async () => {
      // When answer is falsy (undefined), and no chunks were collected,
      // the code falls through to the "Empty response" path
      const sendQueryMock = vi.fn().mockResolvedValue({
        _type: 'client.queryAnswerEx',
        requestId: Buffer.alloc(32),
        answer: undefined,
        flags: 0,
      });
      mockSession.sendQuery = sendQueryMock;

      await expect(
        completions.create({
          model: 'test',
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      ).rejects.toThrow('Empty response');
    });

    it('should forward optional params to request body', async () => {
      let capturedHttpRequest: unknown;

      const sendQueryMock = vi.fn(
        async (modelName: string, httpRequest: unknown, _options?: unknown) => {
          capturedHttpRequest = httpRequest;
          // Return a valid response
          const httpResponse = {
            _type: 'http.response',
            httpVersion: 'HTTP/1.1',
            statusCode: 200,
            reason: 'OK',
            headers: [],
            payload: Buffer.from(
              JSON.stringify({
                id: 'test',
                object: 'chat.completion',
                created: 0,
                model: modelName,
                choices: [],
              }),
            ),
          };
          return {
            _type: 'client.queryAnswerEx',
            requestId: Buffer.alloc(32),
            answer: serializeTLObject(httpResponse as unknown as Record<string, unknown>),
            flags: 0,
          } as unknown as ClientQueryAnswerExType;
        },
      );
      mockSession.sendQuery = sendQueryMock;

      await completions.create({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hi' }],
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 100,
        stop: ['\n'],
        presence_penalty: 0.5,
        frequency_penalty: 0.3,
      });

      // Verify sendQuery was called with the model name
      expect(sendQueryMock).toHaveBeenCalledWith(
        'test-model',
        expect.anything(),
        expect.anything(),
      );

      // The httpRequest payload should contain the parameters
      const req = capturedHttpRequest as { payload: Buffer };
      const bodyStr = req.payload.toString('utf-8');
      const body = JSON.parse(bodyStr);
      expect(body.temperature).toBe(0.7);
      expect(body.top_p).toBe(0.9);
      expect(body.max_tokens).toBe(100);
      expect(body.stop).toEqual(['\n']);
      expect(body.presence_penalty).toBe(0.5);
      expect(body.frequency_penalty).toBe(0.3);
    });

    it('should exclude undefined optional params from body', async () => {
      let capturedHttpRequest: unknown;

      const sendQueryMock = vi.fn(
        async (modelName: string, httpRequest: unknown, _options?: unknown) => {
          capturedHttpRequest = httpRequest;
          const httpResponse = {
            _type: 'http.response',
            httpVersion: 'HTTP/1.1',
            statusCode: 200,
            reason: 'OK',
            headers: [],
            payload: Buffer.from(
              JSON.stringify({
                id: 'test',
                object: 'chat.completion',
                created: 0,
                model: modelName,
                choices: [],
              }),
            ),
          };
          return {
            _type: 'client.queryAnswerEx',
            requestId: Buffer.alloc(32),
            answer: serializeTLObject(httpResponse as unknown as Record<string, unknown>),
            flags: 0,
          } as unknown as ClientQueryAnswerExType;
        },
      );
      mockSession.sendQuery = sendQueryMock;

      await completions.create({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hi' }],
        // No optional params
      });

      const req = capturedHttpRequest as { payload: Buffer };
      const body = JSON.parse(req.payload.toString('utf-8'));
      expect(body.temperature).toBeUndefined();
      expect(body.top_p).toBeUndefined();
      expect(body.max_tokens).toBeUndefined();
      expect(body.stop).toBeUndefined();
    });

    it('should pass max_coefficient and timeout to sendQuery options', async () => {
      const sendQueryMock = vi.fn().mockResolvedValue({
        _type: 'client.queryAnswerEx',
        requestId: Buffer.alloc(32),
        answer: serializeTLObject({
          _type: 'http.response',
          httpVersion: 'HTTP/1.1',
          statusCode: 200,
          reason: 'OK',
          headers: [],
          payload: Buffer.from(
            '{"id":"t","object":"chat.completion","created":0,"model":"m","choices":[]}',
          ),
        } as unknown as Record<string, unknown>),
        flags: 0,
      });
      mockSession.sendQuery = sendQueryMock;

      await completions.create({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hi' }],
        max_coefficient: 5000,
        timeout: 60_000,
      });

      expect(sendQueryMock).toHaveBeenCalledWith(
        'test-model',
        expect.anything(),
        expect.objectContaining({
          maxCoefficient: 5000,
          timeout: 60_000,
        }),
      );
    });
  });

  describe('streaming create', () => {
    it('should return a Stream instance', async () => {
      const sendQueryMock = vi.fn(
        async (
          _modelName: string,
          _httpRequest: unknown,
          options?: { onPart?: (part: ClientQueryAnswerExType) => void },
        ) => {
          // Simulate streaming parts
          if (options?.onPart) {
            // First part: HTTP response headers
            const httpResponse = {
              _type: 'http.response',
              httpVersion: 'HTTP/1.1',
              statusCode: 200,
              reason: 'OK',
              headers: [{ _type: 'http.header', name: 'Content-Type', value: 'text/event-stream' }],
              payload: Buffer.from(
                'data: {"id":"chunk1","object":"chat.completion.chunk","created":0,"model":"m","choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}\n\n',
              ),
            };
            options.onPart({
              _type: 'client.queryAnswerPartEx',
              requestId: Buffer.alloc(32),
              answer: serializeTLObject(httpResponse as unknown as Record<string, unknown>),
              flags: 0,
            } as unknown as ClientQueryAnswerExType);

            // Second part: raw SSE
            options.onPart({
              _type: 'client.queryAnswerPartEx',
              requestId: Buffer.alloc(32),
              answer: Buffer.from(
                'data: {"id":"chunk2","object":"chat.completion.chunk","created":0,"model":"m","choices":[{"index":0,"delta":{"content":"!"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
              ),
              flags: 0,
            } as unknown as ClientQueryAnswerExType);
          }

          return {
            _type: 'client.queryAnswerEx',
            requestId: Buffer.alloc(32),
            answer: Buffer.alloc(0),
            flags: 0,
          } as unknown as ClientQueryAnswerExType;
        },
      );
      mockSession.sendQuery = sendQueryMock;

      const stream = await completions.create({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      });

      expect(stream).toBeInstanceOf(Stream);

      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThanOrEqual(2);
      expect(chunks[0]!.id).toBe('chunk1');
      expect(chunks[1]!.id).toBe('chunk2');
    });

    it('should handle SSE data: [DONE] gracefully', async () => {
      const sendQueryMock = vi.fn(
        async (
          _modelName: string,
          _httpRequest: unknown,
          options?: { onPart?: (part: ClientQueryAnswerExType) => void },
        ) => {
          if (options?.onPart) {
            options.onPart({
              _type: 'client.queryAnswerPartEx',
              requestId: Buffer.alloc(32),
              answer: Buffer.from('data: [DONE]\n\n'),
              flags: 0,
            } as unknown as ClientQueryAnswerExType);
          }
          return {
            _type: 'client.queryAnswerEx',
            requestId: Buffer.alloc(32),
            answer: Buffer.alloc(0),
            flags: 0,
          } as unknown as ClientQueryAnswerExType;
        },
      );
      mockSession.sendQuery = sendQueryMock;

      const stream = await completions.create({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      });

      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      // [DONE] should be skipped, no chunks
      expect(chunks).toHaveLength(0);
    });

    it('should propagate errors in stream', async () => {
      const sendQueryMock = vi.fn().mockRejectedValue(new Error('Connection lost'));
      mockSession.sendQuery = sendQueryMock;

      const stream = await completions.create({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      });

      let caughtError: Error | null = null;
      try {
        for await (const _chunk of stream) {
          // Should not receive any chunks
        }
      } catch (e) {
        caughtError = e as Error;
      }

      expect(caughtError).not.toBeNull();
      expect(caughtError!.message).toBe('Connection lost');
    });
  });
});
