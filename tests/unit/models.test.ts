import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Models } from '../../src/resources/models/models';
import type { CocoonSession } from '../../src/core/protocol/session';

function createMockSession(rpcResult: Record<string, unknown>): CocoonSession {
  return {
    connected: true,
    sendRpcQuery: vi.fn().mockResolvedValue(rpcResult),
  } as unknown as CocoonSession;
}

describe('Models', () => {
  describe('list', () => {
    it('should send getWorkerTypesV2 RPC query', async () => {
      const mockSession = createMockSession({
        _type: 'client.workerTypesV2',
        types: [],
      });
      const models = new Models(async () => mockSession);

      await models.list();

      expect(mockSession.sendRpcQuery).toHaveBeenCalledWith({
        _type: 'client.getWorkerTypesV2',
      });
    });

    it('should return empty data for empty types', async () => {
      const mockSession = createMockSession({
        _type: 'client.workerTypesV2',
        types: [],
      });
      const models = new Models(async () => mockSession);

      const result = await models.list();
      expect(result.object).toBe('list');
      expect(result.data).toEqual([]);
    });

    it('should map workerTypeV2 to Model objects', async () => {
      const mockSession = createMockSession({
        _type: 'client.workerTypesV2',
        types: [
          {
            _type: 'client.workerTypeV2',
            name: 'deepseek-r1',
            workers: [
              {
                _type: 'client.workerInstanceV2',
                flags: 0,
                coefficient: 1000,
                activeRequests: 2,
                maxActiveRequests: 10,
              },
            ],
          },
        ],
      });
      const models = new Models(async () => mockSession);

      const result = await models.list();
      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.id).toBe('deepseek-r1');
      expect(result.data[0]!.object).toBe('model');
      expect(result.data[0]!.owned_by).toBe('cocoon');
      expect(result.data[0]!.active_workers).toBe(1);
      expect(result.data[0]!.coefficient_min).toBe(1000);
      expect(result.data[0]!.coefficient_max).toBe(1000);
    });

    it('should compute coefficient_min and coefficient_max from multiple workers', async () => {
      const mockSession = createMockSession({
        _type: 'client.workerTypesV2',
        types: [
          {
            _type: 'client.workerTypeV2',
            name: 'llama-3',
            workers: [
              {
                _type: 'client.workerInstanceV2',
                flags: 0,
                coefficient: 800,
                activeRequests: 1,
                maxActiveRequests: 5,
              },
              {
                _type: 'client.workerInstanceV2',
                flags: 0,
                coefficient: 1200,
                activeRequests: 3,
                maxActiveRequests: 5,
              },
              {
                _type: 'client.workerInstanceV2',
                flags: 0,
                coefficient: 1000,
                activeRequests: 0,
                maxActiveRequests: 5,
              },
            ],
          },
        ],
      });
      const models = new Models(async () => mockSession);

      const result = await models.list();
      expect(result.data[0]!.active_workers).toBe(3);
      expect(result.data[0]!.coefficient_min).toBe(800);
      expect(result.data[0]!.coefficient_max).toBe(1200);
    });

    it('should handle multiple model types', async () => {
      const mockSession = createMockSession({
        _type: 'client.workerTypesV2',
        types: [
          {
            _type: 'client.workerTypeV2',
            name: 'model-a',
            workers: [
              {
                _type: 'client.workerInstanceV2',
                flags: 0,
                coefficient: 1000,
                activeRequests: 0,
                maxActiveRequests: 10,
              },
            ],
          },
          {
            _type: 'client.workerTypeV2',
            name: 'model-b',
            workers: [
              {
                _type: 'client.workerInstanceV2',
                flags: 0,
                coefficient: 2000,
                activeRequests: 5,
                maxActiveRequests: 10,
              },
            ],
          },
        ],
      });
      const models = new Models(async () => mockSession);

      const result = await models.list();
      expect(result.data).toHaveLength(2);
      expect(result.data[0]!.id).toBe('model-a');
      expect(result.data[1]!.id).toBe('model-b');
    });

    it('should have created field as unix timestamp', async () => {
      const mockSession = createMockSession({
        _type: 'client.workerTypesV2',
        types: [
          {
            _type: 'client.workerTypeV2',
            name: 'test',
            workers: [],
          },
        ],
      });
      const models = new Models(async () => mockSession);

      const result = await models.list();
      const now = Math.floor(Date.now() / 1000);
      // Should be within 2 seconds of now
      expect(result.data[0]!.created).toBeGreaterThan(now - 2);
      expect(result.data[0]!.created).toBeLessThanOrEqual(now + 1);
    });

    it('should handle type with no workers (coefficients default to 0)', async () => {
      const mockSession = createMockSession({
        _type: 'client.workerTypesV2',
        types: [
          {
            _type: 'client.workerTypeV2',
            name: 'empty-model',
            workers: [],
          },
        ],
      });
      const models = new Models(async () => mockSession);

      const result = await models.list();
      expect(result.data[0]!.active_workers).toBe(0);
      expect(result.data[0]!.coefficient_min).toBe(0);
      expect(result.data[0]!.coefficient_max).toBe(0);
    });
  });
});
