import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @ton/ton
vi.mock('@ton/ton', () => {
  const MockAddress = {
    parse: vi.fn().mockReturnValue({ toString: () => 'EQContract' }),
  };

  // Mock beginCell chain
  const cellMock = { toBoc: () => Buffer.alloc(64) };
  const builderMock = {
    storeUint: vi.fn().mockReturnThis(),
    storeCoins: vi.fn().mockReturnThis(),
    storeAddress: vi.fn().mockReturnThis(),
    storeBuffer: vi.fn().mockReturnThis(),
    endCell: vi.fn().mockReturnValue(cellMock),
  };

  return {
    Address: MockAddress,
    beginCell: vi.fn().mockReturnValue(builderMock),
    toNano: vi.fn((val: string) => BigInt(Math.floor(parseFloat(val) * 1_000_000_000))),
  };
});

vi.mock('@ton/core', () => ({
  Address: {
    parse: vi.fn().mockReturnValue({ toString: () => 'EQContract' }),
  },
}));

import { CocoonClientContract } from '../../src/ton/contracts/client-contract';
import { Address, beginCell, toNano } from '@ton/ton';
import type { Sender } from '@ton/core';

describe('CocoonClientContract', () => {
  const ownerAddress = Address.parse('EQOwner');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createRegisterBody', () => {
    it('should store correct opcode', () => {
      CocoonClientContract.createRegisterBody(1234n, ownerAddress);

      const builder = (beginCell as unknown as ReturnType<typeof vi.fn>)();
      // The first storeUint call should be the opcode
      expect(builder.storeUint).toHaveBeenCalledWith(0xc45f9f3b, 32);
    });

    it('should store queryId and nonce', () => {
      CocoonClientContract.createRegisterBody(5678n, ownerAddress, 99n);

      const builder = (beginCell as unknown as ReturnType<typeof vi.fn>)();
      expect(builder.storeUint).toHaveBeenCalledWith(99n, 64); // queryId
      expect(builder.storeUint).toHaveBeenCalledWith(5678n, 64); // nonce
    });

    it('should default queryId to 0', () => {
      CocoonClientContract.createRegisterBody(1234n, ownerAddress);

      const builder = (beginCell as unknown as ReturnType<typeof vi.fn>)();
      expect(builder.storeUint).toHaveBeenCalledWith(0n, 64); // default queryId
    });

    it('should normalize signed values to uint64', () => {
      CocoonClientContract.createRegisterBody(-1n, ownerAddress, -2n);

      const builder = (beginCell as unknown as ReturnType<typeof vi.fn>)();
      expect(builder.storeUint).toHaveBeenCalledWith(BigInt.asUintN(64, -2n), 64);
      expect(builder.storeUint).toHaveBeenCalledWith(BigInt.asUintN(64, -1n), 64);
    });
  });

  describe('createChangeSecretHashBody', () => {
    it('should store correct opcode', () => {
      CocoonClientContract.createChangeSecretHashBody(Buffer.alloc(32), ownerAddress);

      const builder = (beginCell as unknown as ReturnType<typeof vi.fn>)();
      expect(builder.storeUint).toHaveBeenCalledWith(0xa9357034, 32);
    });

    it('should store 32-byte hash', () => {
      const hash = Buffer.alloc(32, 0xab);
      CocoonClientContract.createChangeSecretHashBody(hash, ownerAddress);

      const builder = (beginCell as unknown as ReturnType<typeof vi.fn>)();
      expect(builder.storeBuffer).toHaveBeenCalledWith(hash, 32);
    });
  });

  describe('createTopUpBody', () => {
    it('should store correct opcode', () => {
      CocoonClientContract.createTopUpBody(1000n, ownerAddress);

      const builder = (beginCell as unknown as ReturnType<typeof vi.fn>)();
      expect(builder.storeUint).toHaveBeenCalledWith(0xf172e6c2, 32);
    });

    it('should store queryId', () => {
      CocoonClientContract.createTopUpBody(42n, ownerAddress, 7n);

      const builder = (beginCell as unknown as ReturnType<typeof vi.fn>)();
      expect(builder.storeUint).toHaveBeenCalledWith(7n, 64);
      expect(builder.storeCoins).toHaveBeenCalledWith(42n);
    });
  });

  describe('register', () => {
    it('should call sender.send with correct address and body', async () => {
      const mockSender = {
        send: vi.fn().mockResolvedValue(undefined),
      } as unknown as Sender;

      const address = Address.parse('EQTest');
      const contract = new CocoonClientContract(address);

      await contract.register(mockSender, ownerAddress, 1234n);

      expect(mockSender.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: address,
        }),
      );
    });

    it('should use default amount of 1 TON', async () => {
      const mockSender = {
        send: vi.fn().mockResolvedValue(undefined),
      } as unknown as Sender;

      const address = Address.parse('EQTest');
      const contract = new CocoonClientContract(address);

      await contract.register(mockSender, ownerAddress, 1234n);

      expect(mockSender.send).toHaveBeenCalledWith(
        expect.objectContaining({
          value: toNano('1'),
        }),
      );
    });
  });

  describe('topUp', () => {
    it('should call sender.send with amount', async () => {
      const mockSender = {
        send: vi.fn().mockResolvedValue(undefined),
      } as unknown as Sender;

      const address = Address.parse('EQTest');
      const contract = new CocoonClientContract(address);

      await contract.topUp(mockSender, ownerAddress, 5000000000n);

      expect(mockSender.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: address,
          value: 5000000000n + toNano('0.7'),
        }),
      );
    });
  });

  describe('changeSecretHash', () => {
    it('should call sender.send', async () => {
      const mockSender = {
        send: vi.fn().mockResolvedValue(undefined),
      } as unknown as Sender;

      const address = Address.parse('EQTest');
      const contract = new CocoonClientContract(address);
      const hash = Buffer.alloc(32, 0xff);

      await contract.changeSecretHash(mockSender, ownerAddress, hash);

      expect(mockSender.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: address,
        }),
      );
    });
  });
});
