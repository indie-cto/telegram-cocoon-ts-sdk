import { describe, it, expect } from 'vitest';
import { TLSerializer, serializeTLObject } from '../../src/core/tl/serializer';
import { TLDeserializer, deserializeTLObject } from '../../src/core/tl/deserializer';
import { crc32, TL_SCHEMA } from '../../src/core/tl/schema';

describe('TLSerializer', () => {
  describe('primitives', () => {
    it('should serialize and deserialize int', () => {
      const s = new TLSerializer();
      s.writeInt(42);
      s.writeInt(-1);
      s.writeInt(0);
      s.writeInt(2147483647);

      const buf = s.toBuffer();
      const d = new TLDeserializer(buf);

      expect(d.readInt()).toBe(42);
      expect(d.readInt()).toBe(-1);
      expect(d.readInt()).toBe(0);
      expect(d.readInt()).toBe(2147483647);
    });

    it('should serialize and deserialize long', () => {
      const s = new TLSerializer();
      s.writeLong(0n);
      s.writeLong(123456789012345n);
      s.writeLong(-1n);

      const buf = s.toBuffer();
      const d = new TLDeserializer(buf);

      expect(d.readLong()).toBe(0n);
      expect(d.readLong()).toBe(123456789012345n);
      expect(d.readLong()).toBe(-1n);
    });

    it('should serialize and deserialize double', () => {
      const s = new TLSerializer();
      s.writeDouble(3.14);
      s.writeDouble(0);
      s.writeDouble(-1.5);

      const buf = s.toBuffer();
      const d = new TLDeserializer(buf);

      expect(d.readDouble()).toBeCloseTo(3.14);
      expect(d.readDouble()).toBe(0);
      expect(d.readDouble()).toBe(-1.5);
    });

    it('should serialize and deserialize int128', () => {
      const value = Buffer.alloc(16);
      for (let i = 0; i < 16; i++) value[i] = i;

      const s = new TLSerializer();
      s.writeInt128(value);

      const buf = s.toBuffer();
      const d = new TLDeserializer(buf);
      expect(d.readInt128()).toEqual(value);
    });

    it('should serialize and deserialize int256', () => {
      const value = Buffer.alloc(32);
      for (let i = 0; i < 32; i++) value[i] = i * 7;

      const s = new TLSerializer();
      s.writeInt256(value);

      const buf = s.toBuffer();
      const d = new TLDeserializer(buf);
      expect(d.readInt256()).toEqual(value);
    });

    it('should serialize and deserialize bool', () => {
      const s = new TLSerializer();
      s.writeBool(true);
      s.writeBool(false);

      const buf = s.toBuffer();
      const d = new TLDeserializer(buf);
      expect(d.readBool()).toBe(true);
      expect(d.readBool()).toBe(false);
    });
  });

  describe('string/bytes', () => {
    it('should serialize short strings (< 254 bytes)', () => {
      const s = new TLSerializer();
      s.writeString('hello');

      const buf = s.toBuffer();
      const d = new TLDeserializer(buf);
      expect(d.readString()).toBe('hello');
    });

    it('should serialize empty string', () => {
      const s = new TLSerializer();
      s.writeString('');

      const buf = s.toBuffer();
      const d = new TLDeserializer(buf);
      expect(d.readString()).toBe('');
    });

    it('should serialize strings with padding', () => {
      // "ab" is 2 bytes, header 1 byte = 3 total, needs 1 byte padding to align to 4
      const s = new TLSerializer();
      s.writeString('ab');

      const buf = s.toBuffer();
      expect(buf.length).toBe(4); // 1 header + 2 data + 1 padding = 4

      const d = new TLDeserializer(buf);
      expect(d.readString()).toBe('ab');
    });

    it('should serialize longer strings (>= 254 bytes)', () => {
      const longStr = 'x'.repeat(300);
      const s = new TLSerializer();
      s.writeString(longStr);

      const buf = s.toBuffer();
      const d = new TLDeserializer(buf);
      expect(d.readString()).toBe(longStr);
    });

    it('should serialize bytes', () => {
      const data = Buffer.from([1, 2, 3, 4, 5]);
      const s = new TLSerializer();
      s.writeBytes(data);

      const buf = s.toBuffer();
      const d = new TLDeserializer(buf);
      expect(d.readBytes()).toEqual(data);
    });

    it('should handle UTF-8 strings', () => {
      const str = 'Привет мир 🌍';
      const s = new TLSerializer();
      s.writeString(str);

      const buf = s.toBuffer();
      const d = new TLDeserializer(buf);
      expect(d.readString()).toBe(str);
    });
  });

  describe('vectors', () => {
    it('should serialize vector of ints', () => {
      const s = new TLSerializer();
      s.writeVector([1, 2, 3], 'int');

      const buf = s.toBuffer();
      const d = new TLDeserializer(buf);
      expect(d.readVector('int')).toEqual([1, 2, 3]);
    });

    it('should serialize empty vector', () => {
      const s = new TLSerializer();
      s.writeVector([], 'int');

      const buf = s.toBuffer();
      const d = new TLDeserializer(buf);
      expect(d.readVector('int')).toEqual([]);
    });

    it('should serialize vector of strings', () => {
      const s = new TLSerializer();
      s.writeVector(['hello', 'world'], 'string');

      const buf = s.toBuffer();
      const d = new TLDeserializer(buf);
      expect(d.readVector('string')).toEqual(['hello', 'world']);
    });
  });
});

describe('crc32', () => {
  it('should compute correct CRC32 for known strings', () => {
    // These are well-known CRC32 values
    expect(crc32('')).toBe(0x00000000);
    // The CRC32 function should produce consistent results
    const id1 = crc32('tcp.ping id:long = tcp.Packet');
    const id2 = crc32('tcp.ping id:long = tcp.Packet');
    expect(id1).toBe(id2);
    expect(typeof id1).toBe('number');
    expect(id1).toBeGreaterThan(0);
  });
});

describe('TL Schema', () => {
  it('should have unique constructor IDs', () => {
    const ids = new Set<number>();
    for (const [name, def] of Object.entries(TL_SCHEMA)) {
      expect(ids.has(def.id)).toBe(false);
      ids.add(def.id);
    }
  });

  it('should have explicit IDs for types with # suffix', () => {
    expect(TL_SCHEMA['proxy.params']!.id).toBe(0xd5c5609f);
    expect(TL_SCHEMA['client.params']!.id).toBe(0x40fdca64);
    expect(TL_SCHEMA['worker.params']!.id).toBe(0x869c73ed);
    expect(TL_SCHEMA['client.workerInstanceV2']!.id).toBe(0x3ea93d00);
  });
});

describe('TL Object round-trip', () => {
  it('should round-trip tcp.ping', () => {
    const obj = { _type: 'tcp.ping', id: 12345n };
    const buf = serializeTLObject(obj as unknown as Record<string, unknown>);
    const result = deserializeTLObject(buf);
    expect(result['_type']).toBe('tcp.ping');
    expect(result['id']).toBe(12345n);
  });

  it('should round-trip tcp.connect', () => {
    const obj = { _type: 'tcp.connect', id: 99999n };
    const buf = serializeTLObject(obj as unknown as Record<string, unknown>);
    const result = deserializeTLObject(buf);
    expect(result['_type']).toBe('tcp.connect');
    expect(result['id']).toBe(99999n);
  });

  it('should round-trip tcp.queryAnswer', () => {
    const data = Buffer.from('hello world');
    const obj = { _type: 'tcp.queryAnswer', id: 42n, data };
    const buf = serializeTLObject(obj as unknown as Record<string, unknown>);
    const result = deserializeTLObject(buf);
    expect(result['_type']).toBe('tcp.queryAnswer');
    expect(result['id']).toBe(42n);
    expect(result['data']).toEqual(data);
  });

  it('should round-trip tcp.queryError', () => {
    const obj = { _type: 'tcp.queryError', id: 1n, code: 404, message: 'not found' };
    const buf = serializeTLObject(obj as unknown as Record<string, unknown>);
    const result = deserializeTLObject(buf);
    expect(result['_type']).toBe('tcp.queryError');
    expect(result['id']).toBe(1n);
    expect(result['code']).toBe(404);
    expect(result['message']).toBe('not found');
  });

  it('should round-trip http.header', () => {
    const obj = { _type: 'http.header', name: 'Content-Type', value: 'application/json' };
    const buf = serializeTLObject(obj as unknown as Record<string, unknown>);
    const result = deserializeTLObject(buf);
    expect(result['_type']).toBe('http.header');
    expect(result['name']).toBe('Content-Type');
    expect(result['value']).toBe('application/json');
  });

  it('should round-trip http.request with headers', () => {
    const obj = {
      _type: 'http.request',
      method: 'POST',
      url: '/v1/chat/completions',
      httpVersion: 'HTTP/1.1',
      headers: [{ _type: 'http.header', name: 'Content-Type', value: 'application/json' }],
      payload: Buffer.from('{"model":"test"}'),
    };
    const buf = serializeTLObject(obj as unknown as Record<string, unknown>);
    const result = deserializeTLObject(buf);
    expect(result['_type']).toBe('http.request');
    expect(result['method']).toBe('POST');
    expect(result['url']).toBe('/v1/chat/completions');
    const headers = result['headers'] as Record<string, unknown>[];
    expect(headers).toHaveLength(1);
    expect(headers[0]!['name']).toBe('Content-Type');
  });

  it('should round-trip client.params with flags', () => {
    const obj = {
      _type: 'client.params',
      flags: 3,
      clientOwnerAddress: 'EQTest123',
      isTest: true,
      minProtoVersion: 0,
      maxProtoVersion: 1,
    };
    const buf = serializeTLObject(obj as unknown as Record<string, unknown>);
    const result = deserializeTLObject(buf);
    expect(result['_type']).toBe('client.params');
    expect(result['clientOwnerAddress']).toBe('EQTest123');
    expect(result['isTest']).toBe(true);
    expect(result['minProtoVersion']).toBe(0);
    expect(result['maxProtoVersion']).toBe(1);
  });

  it('should round-trip proxy.signedPaymentEmpty (no fields)', () => {
    const obj = { _type: 'proxy.signedPaymentEmpty' };
    const buf = serializeTLObject(obj as unknown as Record<string, unknown>);
    const result = deserializeTLObject(buf);
    expect(result['_type']).toBe('proxy.signedPaymentEmpty');
  });

  it('should round-trip client.connectToProxy with nested objects', () => {
    const obj = {
      _type: 'client.connectToProxy',
      params: {
        _type: 'client.params',
        flags: 3,
        clientOwnerAddress: 'EQTest',
        isTest: true,
        minProtoVersion: 0,
        maxProtoVersion: 1,
      },
      minConfigVersion: 5,
    };
    const buf = serializeTLObject(obj as unknown as Record<string, unknown>);
    const result = deserializeTLObject(buf);
    expect(result['_type']).toBe('client.connectToProxy');
    expect(result['minConfigVersion']).toBe(5);
    const params = result['params'] as Record<string, unknown>;
    expect(params['_type']).toBe('client.params');
    expect(params['clientOwnerAddress']).toBe('EQTest');
  });

  it('should round-trip client.getWorkerTypesV2 (empty function)', () => {
    const obj = { _type: 'client.getWorkerTypesV2' };
    const buf = serializeTLObject(obj as unknown as Record<string, unknown>);
    const result = deserializeTLObject(buf);
    expect(result['_type']).toBe('client.getWorkerTypesV2');
  });

  it('should round-trip tokensUsed', () => {
    const obj = {
      _type: 'tokensUsed',
      promptTokensUsed: 100n,
      cachedTokensUsed: 0n,
      completionTokensUsed: 50n,
      reasoningTokensUsed: 0n,
      totalTokensUsed: 150n,
    };
    const buf = serializeTLObject(obj as unknown as Record<string, unknown>);
    const result = deserializeTLObject(buf);
    expect(result['_type']).toBe('tokensUsed');
    expect(result['promptTokensUsed']).toBe(100n);
    expect(result['totalTokensUsed']).toBe(150n);
  });

  it('should round-trip client.workerTypesV2 with nested vectors', () => {
    const obj = {
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
    };
    const buf = serializeTLObject(obj as unknown as Record<string, unknown>);
    const result = deserializeTLObject(buf);
    expect(result['_type']).toBe('client.workerTypesV2');
    const types = result['types'] as Record<string, unknown>[];
    expect(types).toHaveLength(1);
    expect(types[0]!['name']).toBe('deepseek-r1');
    const workers = types[0]!['workers'] as Record<string, unknown>[];
    expect(workers).toHaveLength(1);
    expect(workers[0]!['coefficient']).toBe(1000);
  });
});

describe('TLSerializer edge cases', () => {
  it('should handle int boundary values', () => {
    const s = new TLSerializer();
    s.writeInt(-2147483648); // INT32_MIN
    s.writeInt(2147483647); // INT32_MAX

    const buf = s.toBuffer();
    const d = new TLDeserializer(buf);
    expect(d.readInt()).toBe(-2147483648);
    expect(d.readInt()).toBe(2147483647);
  });

  it('should round-trip string of exactly 253 bytes (last short header)', () => {
    const str = 'X'.repeat(253);
    const s = new TLSerializer();
    s.writeString(str);

    const buf = s.toBuffer();
    const d = new TLDeserializer(buf);
    expect(d.readString()).toBe(str);

    // Short header: 1 byte header + 253 data = 254, needs 2 bytes padding to align to 256
    expect(buf.length).toBe(256);
  });

  it('should round-trip string of exactly 254 bytes (first long header)', () => {
    const str = 'Y'.repeat(254);
    const s = new TLSerializer();
    s.writeString(str);

    const buf = s.toBuffer();
    const d = new TLDeserializer(buf);
    expect(d.readString()).toBe(str);

    // Long header: 4 byte header + 254 data = 258, needs 2 bytes padding to align to 260
    expect(buf.length).toBe(260);
  });

  it('should throw for unknown _type in writeObject', () => {
    const s = new TLSerializer();
    expect(() => s.writeObject({ _type: 'nonexistent.type' })).toThrow('Unknown TL type');
  });

  it('should throw for missing _type in writeObject', () => {
    const s = new TLSerializer();
    expect(() => s.writeObject({ foo: 'bar' })).toThrow('must have _type');
  });

  it('should throw for int128 with wrong buffer length', () => {
    const s = new TLSerializer();
    expect(() => s.writeInt128(Buffer.alloc(8))).toThrow('int128 must be 16 bytes');
  });

  it('should throw for int256 with wrong buffer length', () => {
    const s = new TLSerializer();
    expect(() => s.writeInt256(Buffer.alloc(16))).toThrow('int256 must be 32 bytes');
  });
});
