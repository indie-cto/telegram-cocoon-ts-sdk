import { describe, it, expect } from 'vitest';
import { TLDeserializer, deserializeTLObject } from '../../src/core/tl/deserializer';
import { TLSerializer, serializeTLObject } from '../../src/core/tl/serializer';

describe('TLDeserializer', () => {
  describe('primitive readers', () => {
    it('readInt should read a 4-byte LE signed integer', () => {
      const buf = Buffer.alloc(4);
      buf.writeInt32LE(-42, 0);
      const d = new TLDeserializer(buf);
      expect(d.readInt()).toBe(-42);
    });

    it('readUInt should read a 4-byte LE unsigned integer', () => {
      const buf = Buffer.alloc(4);
      buf.writeUInt32LE(0xdeadbeef, 0);
      const d = new TLDeserializer(buf);
      expect(d.readUInt()).toBe(0xdeadbeef);
    });

    it('readLong should read an 8-byte LE signed bigint', () => {
      const buf = Buffer.alloc(8);
      buf.writeBigInt64LE(-9876543210n, 0);
      const d = new TLDeserializer(buf);
      expect(d.readLong()).toBe(-9876543210n);
    });

    it('readDouble should read an 8-byte LE double', () => {
      const buf = Buffer.alloc(8);
      buf.writeDoubleLE(2.718281828, 0);
      const d = new TLDeserializer(buf);
      expect(d.readDouble()).toBeCloseTo(2.718281828);
    });

    it('readInt128 should read 16 raw bytes', () => {
      const expected = Buffer.alloc(16);
      for (let i = 0; i < 16; i++) expected[i] = i + 10;
      const d = new TLDeserializer(expected);
      expect(d.readInt128()).toEqual(expected);
    });

    it('readInt256 should read 32 raw bytes', () => {
      const expected = Buffer.alloc(32);
      for (let i = 0; i < 32; i++) expected[i] = 255 - i;
      const d = new TLDeserializer(expected);
      expect(d.readInt256()).toEqual(expected);
    });
  });

  describe('remaining bytes tracking', () => {
    it('should track remaining bytes correctly', () => {
      const buf = Buffer.alloc(12);
      const d = new TLDeserializer(buf);
      expect(d.remaining).toBe(12);
      d.readInt();
      expect(d.remaining).toBe(8);
      d.readInt();
      expect(d.remaining).toBe(4);
      d.readInt();
      expect(d.remaining).toBe(0);
    });
  });

  describe('buffer underflow', () => {
    it('readInt should throw on insufficient data', () => {
      const d = new TLDeserializer(Buffer.alloc(2));
      expect(() => d.readInt()).toThrow('Buffer underflow');
    });

    it('readLong should throw on insufficient data', () => {
      const d = new TLDeserializer(Buffer.alloc(4));
      expect(() => d.readLong()).toThrow('Buffer underflow');
    });

    it('readDouble should throw on insufficient data', () => {
      const d = new TLDeserializer(Buffer.alloc(3));
      expect(() => d.readDouble()).toThrow('Buffer underflow');
    });

    it('readInt128 should throw on insufficient data', () => {
      const d = new TLDeserializer(Buffer.alloc(10));
      expect(() => d.readInt128()).toThrow('Buffer underflow');
    });

    it('readInt256 should throw on insufficient data', () => {
      const d = new TLDeserializer(Buffer.alloc(20));
      expect(() => d.readInt256()).toThrow('Buffer underflow');
    });

    it('readBytes should throw on empty buffer', () => {
      const d = new TLDeserializer(Buffer.alloc(0));
      expect(() => d.readBytes()).toThrow('Buffer underflow');
    });

    it('readBytes should throw when data shorter than length header', () => {
      // Header says 10 bytes, but only 2 bytes follow the header
      const buf = Buffer.alloc(4);
      buf[0] = 10; // length = 10
      const d = new TLDeserializer(buf);
      expect(() => d.readBytes()).toThrow('Buffer underflow');
    });
  });

  describe('unknown constructor ID', () => {
    it('readObject should throw for unknown constructor ID', () => {
      const buf = Buffer.alloc(4);
      buf.writeUInt32LE(0x12345678, 0);
      const d = new TLDeserializer(buf);
      expect(() => d.readObject()).toThrow('Unknown TL constructor ID');
    });
  });

  describe('invalid Bool constructor ID', () => {
    it('readBool should throw for non-Bool constructor ID', () => {
      const buf = Buffer.alloc(4);
      buf.writeUInt32LE(0xaabbccdd, 0);
      const d = new TLDeserializer(buf);
      expect(() => d.readBool()).toThrow('Invalid Bool constructor ID');
    });
  });

  describe('readObjectBare', () => {
    it('should read fields of a known type without constructor ID', () => {
      // Serialize tcp.ping without writing it as a full object
      const s = new TLSerializer();
      s.writeLong(777n);
      const buf = s.toBuffer();

      const d = new TLDeserializer(buf);
      const result = d.readObjectBare('tcp.ping');
      expect(result['_type']).toBe('tcp.ping');
      expect(result['id']).toBe(777n);
    });

    it('should throw for unknown type name', () => {
      const d = new TLDeserializer(Buffer.alloc(8));
      expect(() => d.readObjectBare('nonexistent.type')).toThrow('Unknown TL type');
    });
  });

  describe('long strings (>= 254 bytes)', () => {
    it('should round-trip a string of exactly 254 bytes', () => {
      const str = 'A'.repeat(254);
      const s = new TLSerializer();
      s.writeString(str);
      const d = new TLDeserializer(s.toBuffer());
      expect(d.readString()).toBe(str);
    });

    it('should round-trip a string of 1000 bytes', () => {
      const str = 'B'.repeat(1000);
      const s = new TLSerializer();
      s.writeString(str);
      const d = new TLDeserializer(s.toBuffer());
      expect(d.readString()).toBe(str);
    });
  });

  describe('conditional flag fields', () => {
    it('should read fields when flags bit is set', () => {
      const obj = {
        _type: 'client.params',
        flags: 3, // bits 0 and 1 set
        clientOwnerAddress: 'EQTest',
        isTest: true,
        minProtoVersion: 0,
        maxProtoVersion: 1,
      };
      const buf = serializeTLObject(obj as unknown as Record<string, unknown>);
      const result = deserializeTLObject(buf);
      expect(result['isTest']).toBe(true);
      expect(result['minProtoVersion']).toBe(0);
      expect(result['maxProtoVersion']).toBe(1);
    });

    it('should skip fields when flags bit is not set', () => {
      // Manually construct a client.params with flags=0 (no optional fields)
      const obj = {
        _type: 'client.params',
        flags: 0,
        clientOwnerAddress: 'EQTest',
      };
      const buf = serializeTLObject(obj as unknown as Record<string, unknown>);
      const result = deserializeTLObject(buf);
      expect(result['isTest']).toBeUndefined();
      expect(result['minProtoVersion']).toBeUndefined();
      expect(result['maxProtoVersion']).toBeUndefined();
    });

    it('should handle queryFinalInfo with optional debug fields', () => {
      const obj = {
        _type: 'client.queryFinalInfo',
        flags: 3, // bits 0 and 1
        tokensUsed: {
          _type: 'tokensUsed',
          promptTokensUsed: 10n,
          cachedTokensUsed: 0n,
          completionTokensUsed: 5n,
          reasoningTokensUsed: 0n,
          totalTokensUsed: 15n,
        },
        workerDebug: 'debug-worker',
        proxyDebug: 'debug-proxy',
        proxyStartTime: 1.0,
        proxyEndTime: 2.0,
        workerStartTime: 1.1,
        workerEndTime: 1.9,
      };
      const buf = serializeTLObject(obj as unknown as Record<string, unknown>);
      const result = deserializeTLObject(buf);
      expect(result['_type']).toBe('client.queryFinalInfo');
      expect(result['workerDebug']).toBe('debug-worker');
      expect(result['proxyDebug']).toBe('debug-proxy');
      expect(result['proxyStartTime']).toBeCloseTo(1.0);
    });
  });

  describe('deserializeTLObject', () => {
    it('should deserialize a full boxed TL object from buffer', () => {
      const obj = { _type: 'tcp.pong', id: 42n };
      const buf = serializeTLObject(obj as unknown as Record<string, unknown>);
      const result = deserializeTLObject(buf);
      expect(result['_type']).toBe('tcp.pong');
      expect(result['id']).toBe(42n);
    });
  });
});
