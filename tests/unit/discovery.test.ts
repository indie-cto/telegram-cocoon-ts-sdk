import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @ton/ton and the root contract
vi.mock('@ton/ton', () => {
  const MockTonClient = vi.fn().mockImplementation(() => ({}));
  const MockAddress = {
    parse: vi.fn().mockReturnValue({ toString: () => 'EQRoot' }),
  };

  return { TonClient: MockTonClient, Address: MockAddress };
});

const mockGetAllParams = vi.fn();

vi.mock('../../src/ton/contracts/root', () => {
  return {
    CocoonRoot: vi.fn().mockImplementation(() => ({
      getAllParams: mockGetAllParams,
    })),
  };
});

import { ProxyDiscovery } from '../../src/ton/discovery';

describe('ProxyDiscovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllParams.mockResolvedValue({
      registeredProxies: [
        { seqno: 1, address: 'proxy1.example.com:8080' },
        { seqno: 2, address: 'proxy2.example.com:8080' },
      ],
      version: 1,
      paramsVersion: 1,
      pricePerToken: 100n,
      workerFeePerToken: 50n,
      minClientStake: 1000000000n,
    });
  });

  describe('constructor', () => {
    it('should use mainnet endpoint by default', () => {
      const disc = new ProxyDiscovery({ network: 'mainnet' });
      expect(disc).toBeDefined();
    });

    it('should use testnet endpoint for testnet', () => {
      const disc = new ProxyDiscovery({ network: 'testnet' });
      expect(disc).toBeDefined();
    });

    it('should accept custom rootContractAddress', () => {
      const disc = new ProxyDiscovery({
        network: 'mainnet',
        rootContractAddress: 'EQCustomRoot',
      });
      expect(disc).toBeDefined();
    });

    it('should accept custom tonApiEndpoint', () => {
      const disc = new ProxyDiscovery({
        network: 'mainnet',
        tonApiEndpoint: 'https://custom-api.example.com',
      });
      expect(disc).toBeDefined();
    });
  });

  describe('getProxies', () => {
    it('should return proxies from root params', async () => {
      const disc = new ProxyDiscovery({ network: 'mainnet' });
      const proxies = await disc.getProxies();
      expect(proxies).toHaveLength(2);
      expect(proxies[0]!.address).toBe('proxy1.example.com:8080');
      expect(proxies[1]!.address).toBe('proxy2.example.com:8080');
    });
  });

  describe('getRandomProxy', () => {
    it('should return a proxy', async () => {
      const disc = new ProxyDiscovery({ network: 'mainnet' });
      const proxy = await disc.getRandomProxy();
      expect(proxy.address).toMatch(/proxy[12]\.example\.com:8080/);
    });

    it('should throw when no proxies available', async () => {
      mockGetAllParams.mockResolvedValue({
        registeredProxies: [],
        version: 1,
        paramsVersion: 1,
        pricePerToken: 100n,
        workerFeePerToken: 50n,
        minClientStake: 1000000000n,
      });

      const disc = new ProxyDiscovery({ network: 'mainnet' });
      await expect(disc.getRandomProxy()).rejects.toThrow('No proxies available');
    });
  });

  describe('getRootParams caching', () => {
    it('should cache results within TTL', async () => {
      const disc = new ProxyDiscovery({ network: 'mainnet' });

      await disc.getRootParams();
      await disc.getRootParams();

      // Should only call getAllParams once (cached)
      expect(mockGetAllParams).toHaveBeenCalledTimes(1);
    });

    it('should refetch after cache TTL expires', async () => {
      vi.useFakeTimers();
      const disc = new ProxyDiscovery({ network: 'mainnet' });

      await disc.getRootParams();
      expect(mockGetAllParams).toHaveBeenCalledTimes(1);

      // Advance past 60s cache TTL
      vi.advanceTimersByTime(61_000);

      await disc.getRootParams();
      expect(mockGetAllParams).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });
  });
});
