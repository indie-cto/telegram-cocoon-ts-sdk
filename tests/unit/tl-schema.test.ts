import { describe, it, expect } from 'vitest';
import { crc32, TL_SCHEMA, CONSTRUCTOR_ID_MAP, POLYMORPHIC_TYPES } from '../../src/core/tl/schema';

describe('crc32', () => {
  it('should return 0 for empty string', () => {
    expect(crc32('')).toBe(0);
  });

  it('should be deterministic', () => {
    const result1 = crc32('hello world');
    const result2 = crc32('hello world');
    expect(result1).toBe(result2);
  });

  it('should return different values for different strings', () => {
    expect(crc32('foo')).not.toBe(crc32('bar'));
  });

  it('should return a positive 32-bit unsigned integer', () => {
    const result = crc32('test input');
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(0xffffffff);
  });
});

describe('TL_SCHEMA', () => {
  it('should have all schema IDs unique', () => {
    const ids = new Set<number>();
    for (const [name, def] of Object.entries(TL_SCHEMA)) {
      expect(ids.has(def.id), `Duplicate ID for ${name}: 0x${def.id.toString(16)}`).toBe(false);
      ids.add(def.id);
    }
  });

  it('should have explicit IDs for proxy.params', () => {
    expect(TL_SCHEMA['proxy.params']!.id).toBe(0xd5c5609f);
  });

  it('should have explicit IDs for client.params', () => {
    expect(TL_SCHEMA['client.params']!.id).toBe(0x40fdca64);
  });

  it('should have explicit IDs for worker.params', () => {
    expect(TL_SCHEMA['worker.params']!.id).toBe(0x869c73ed);
  });

  it('should have explicit IDs for client.workerInstanceV2', () => {
    expect(TL_SCHEMA['client.workerInstanceV2']!.id).toBe(0x3ea93d00);
  });

  it('should have field definitions for all types', () => {
    for (const [name, def] of Object.entries(TL_SCHEMA)) {
      expect(Array.isArray(def.fields), `${name} should have fields array`).toBe(true);
      expect(typeof def.id, `${name} should have numeric id`).toBe('number');
    }
  });

  it('should mark functions with isFunction', () => {
    expect(TL_SCHEMA['client.connectToProxy']!.isFunction).toBe(true);
    expect(TL_SCHEMA['client.authorizeWithProxyShort']!.isFunction).toBe(true);
    expect(TL_SCHEMA['client.authorizeWithProxyLong']!.isFunction).toBe(true);
    expect(TL_SCHEMA['client.runQueryEx']!.isFunction).toBe(true);
    expect(TL_SCHEMA['client.getWorkerTypesV2']!.isFunction).toBe(true);
    expect(TL_SCHEMA['http.request']!.isFunction).toBe(true);
  });

  it('should not mark non-functions with isFunction', () => {
    expect(TL_SCHEMA['tcp.ping']!.isFunction).toBeUndefined();
    expect(TL_SCHEMA['tcp.pong']!.isFunction).toBeUndefined();
    expect(TL_SCHEMA['client.params']!.isFunction).toBeUndefined();
  });

  it('all flag refs should point to valid flag fields', () => {
    for (const [name, def] of Object.entries(TL_SCHEMA)) {
      for (const field of def.fields) {
        if (field.flag) {
          const flagField = def.fields.find((f) => f.name === field.flag!.field);
          expect(
            flagField,
            `${name}.${field.name} references flag field '${field.flag.field}' which does not exist`,
          ).toBeDefined();
          expect(field.flag.bit).toBeGreaterThanOrEqual(0);
          expect(field.flag.bit).toBeLessThan(32);
        }
      }
    }
  });
});

describe('CONSTRUCTOR_ID_MAP', () => {
  it('should have an entry for each schema type', () => {
    for (const [name, def] of Object.entries(TL_SCHEMA)) {
      expect(CONSTRUCTOR_ID_MAP.get(def.id), `Missing CONSTRUCTOR_ID_MAP entry for ${name}`).toBe(
        name,
      );
    }
  });

  it('should have same size as TL_SCHEMA', () => {
    expect(CONSTRUCTOR_ID_MAP.size).toBe(Object.keys(TL_SCHEMA).length);
  });
});

describe('POLYMORPHIC_TYPES', () => {
  it('should reference valid constructors in TL_SCHEMA', () => {
    for (const [polyType, constructors] of Object.entries(POLYMORPHIC_TYPES)) {
      for (const ctor of constructors) {
        expect(
          TL_SCHEMA[ctor],
          `${polyType} references constructor '${ctor}' not found in TL_SCHEMA`,
        ).toBeDefined();
      }
    }
  });

  it('should contain expected polymorphic types', () => {
    expect(POLYMORPHIC_TYPES['tcp.Packet']).toBeDefined();
    expect(POLYMORPHIC_TYPES['client.ProxyConnectionAuth']).toBeDefined();
    expect(POLYMORPHIC_TYPES['proxy.SignedPayment']).toBeDefined();
    expect(POLYMORPHIC_TYPES['client.AuthorizationWithProxy']).toBeDefined();
    expect(POLYMORPHIC_TYPES['client.QueryAnswerEx']).toBeDefined();
    expect(POLYMORPHIC_TYPES['client.Refund']).toBeDefined();
  });

  it('tcp.Packet should have all TCP constructors', () => {
    const expected = [
      'tcp.ping',
      'tcp.pong',
      'tcp.packet',
      'tcp.queryAnswer',
      'tcp.queryError',
      'tcp.query',
      'tcp.connected',
      'tcp.connect',
    ];
    expect(POLYMORPHIC_TYPES['tcp.Packet']).toEqual(expected);
  });
});
