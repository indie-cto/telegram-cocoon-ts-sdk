/**
 * TL Binary Deserializer.
 *
 * Deserializes TL binary data into JavaScript objects.
 */

import {
  TL_SCHEMA,
  CONSTRUCTOR_ID_MAP,
  POLYMORPHIC_TYPES,
  type TLFieldType,
  type TLConstructorDef,
} from './schema.js';

const VECTOR_ID = 0x1cb5c415;
const BOOL_TRUE_ID = 0x997275b5;
const BOOL_FALSE_ID = 0xbc799737;

export class TLDeserializer {
  private buffer: Buffer;
  private offset: number;

  constructor(buffer: Buffer) {
    this.buffer = buffer;
    this.offset = 0;
  }

  get remaining(): number {
    return this.buffer.length - this.offset;
  }

  readInt(): number {
    this.checkRemaining(4);
    const value = this.buffer.readInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  readUInt(): number {
    this.checkRemaining(4);
    const value = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  readLong(): bigint {
    this.checkRemaining(8);
    const value = this.buffer.readBigInt64LE(this.offset);
    this.offset += 8;
    return value;
  }

  readDouble(): number {
    this.checkRemaining(8);
    const value = this.buffer.readDoubleLE(this.offset);
    this.offset += 8;
    return value;
  }

  readInt128(): Buffer {
    this.checkRemaining(16);
    const value = Buffer.alloc(16);
    this.buffer.copy(value, 0, this.offset, this.offset + 16);
    this.offset += 16;
    return value;
  }

  readInt256(): Buffer {
    this.checkRemaining(32);
    const value = Buffer.alloc(32);
    this.buffer.copy(value, 0, this.offset, this.offset + 32);
    this.offset += 32;
    return value;
  }

  readBytes(): Buffer {
    this.checkRemaining(1);
    let length: number;
    let headerLen: number;

    const firstByte = this.buffer[this.offset]!;
    if (firstByte < 254) {
      length = firstByte;
      headerLen = 1;
      this.offset += 1;
    } else {
      this.checkRemaining(4);
      length =
        this.buffer[this.offset + 1]! |
        (this.buffer[this.offset + 2]! << 8) |
        (this.buffer[this.offset + 3]! << 16);
      headerLen = 4;
      this.offset += 4;
    }

    this.checkRemaining(length);
    const value = Buffer.alloc(length);
    this.buffer.copy(value, 0, this.offset, this.offset + length);
    this.offset += length;

    // Skip padding
    const totalLen = headerLen + length;
    const padding = (4 - (totalLen % 4)) % 4;
    this.offset += padding;

    return value;
  }

  readString(): string {
    return this.readBytes().toString('utf-8');
  }

  readBool(): boolean {
    const id = this.readUInt();
    if (id === BOOL_TRUE_ID) return true;
    if (id === BOOL_FALSE_ID) return false;
    throw new Error(`Invalid Bool constructor ID: 0x${id.toString(16)}`);
  }

  readVector(itemType: TLFieldType, bare = false): unknown[] {
    if (!bare) {
      const id = this.readUInt();
      if (id !== VECTOR_ID) {
        throw new Error(
          `Expected vector constructor ID 0x${VECTOR_ID.toString(16)}, got 0x${id.toString(16)}`,
        );
      }
    }
    const count = this.readInt();
    const items: unknown[] = [];
    for (let i = 0; i < count; i++) {
      items.push(this.readField(itemType));
    }
    return items;
  }

  /**
   * Read a boxed TL object: reads constructor ID, looks up schema, reads fields.
   */
  readObject(): Record<string, unknown> {
    const constructorId = this.readUInt();
    const typeName = CONSTRUCTOR_ID_MAP.get(constructorId);
    if (!typeName) {
      throw new Error(
        `Unknown TL constructor ID: 0x${constructorId.toString(16).padStart(8, '0')}`,
      );
    }

    const schema = TL_SCHEMA[typeName]!;
    return this.readFields(typeName, schema);
  }

  /**
   * Read fields of a known TL type (without reading constructor ID).
   */
  readObjectBare(typeName: string): Record<string, unknown> {
    const schema = TL_SCHEMA[typeName];
    if (!schema) throw new Error(`Unknown TL type: ${typeName}`);
    return this.readFields(typeName, schema);
  }

  private readFields(typeName: string, schema: TLConstructorDef): Record<string, unknown> {
    const result: Record<string, unknown> = { _type: typeName };
    const flagValues: Record<string, number> = {};

    for (const field of schema.fields) {
      // Check if this is a conditional field
      if (field.flag) {
        const flagVal = flagValues[field.flag.field] ?? 0;
        if (!(flagVal & (1 << field.flag.bit))) {
          continue; // Field not present
        }
      }

      const value = this.readField(field.type);
      result[field.name] = value;

      // Track flag values for conditional fields
      if (field.type === 'int' && schema.fields.some((f) => f.flag?.field === field.name)) {
        flagValues[field.name] = value as number;
      }
    }

    return result;
  }

  readField(type: TLFieldType): unknown {
    if (typeof type === 'string') {
      switch (type) {
        case 'int':
          return this.readInt();
        case 'long':
          return this.readLong();
        case 'double':
          return this.readDouble();
        case 'int128':
          return this.readInt128();
        case 'int256':
          return this.readInt256();
        case 'string':
          return this.readString();
        case 'bytes':
          return this.readBytes();
        case 'Bool':
          return this.readBool();
        case 'true':
          return true; // Bare true is present by virtue of the flag being set
        default:
          throw new Error(`Unknown primitive type: ${type}`);
      }
    } else if ('vector' in type) {
      return this.readVector(type.vector, Boolean(type.bare));
    } else if ('ref' in type) {
      if (type.ref in POLYMORPHIC_TYPES) {
        // Boxed polymorphic type — constructor ID determines concrete type.
        return this.readObject();
      }
      if (type.ref in TL_SCHEMA) {
        // Concrete constructor refs are bare (no nested constructor ID).
        return this.readObjectBare(type.ref);
      }
      throw new Error(`Unknown TL ref type: ${type.ref}`);
    }

    throw new Error(`Unhandled field type: ${JSON.stringify(type)}`);
  }

  private checkRemaining(needed: number): void {
    if (this.offset + needed > this.buffer.length) {
      throw new Error(
        `Buffer underflow: need ${needed} bytes at offset ${this.offset}, ` +
          `but only ${this.buffer.length - this.offset} remain`,
      );
    }
  }
}

/**
 * Deserialize a boxed TL object from a Buffer.
 */
export function deserializeTLObject(buffer: Buffer): Record<string, unknown> {
  const d = new TLDeserializer(buffer);
  return d.readObject();
}
