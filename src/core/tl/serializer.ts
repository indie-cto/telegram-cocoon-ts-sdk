/**
 * TL Binary Serializer.
 *
 * Serializes TL objects into binary format following the TL specification:
 * - int: 4 bytes LE
 * - long: 8 bytes LE
 * - double: 8 bytes LE (IEEE 754)
 * - int128: 16 bytes raw
 * - int256: 32 bytes raw
 * - string/bytes: length-prefixed with padding to 4-byte alignment
 * - vector: constructor_id(0x1cb5c415) + count + elements
 * - Bool: boolTrue(0x997275b5) or boolFalse(0xbc799737)
 */

import { TL_SCHEMA, type TLFieldType, type TLConstructorDef } from './schema.js';

const VECTOR_ID = 0x1cb5c415;
const BOOL_TRUE_ID = 0x997275b5;
const BOOL_FALSE_ID = 0xbc799737;

export class TLSerializer {
  private buffers: Buffer[] = [];
  private totalLength = 0;

  writeInt(value: number): void {
    const buf = Buffer.alloc(4);
    buf.writeInt32LE(value, 0);
    this.push(buf);
  }

  writeUInt(value: number): void {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(value, 0);
    this.push(buf);
  }

  writeLong(value: bigint): void {
    const buf = Buffer.alloc(8);
    buf.writeBigInt64LE(value, 0);
    this.push(buf);
  }

  writeDouble(value: number): void {
    const buf = Buffer.alloc(8);
    buf.writeDoubleLE(value, 0);
    this.push(buf);
  }

  writeInt128(value: Buffer): void {
    if (value.length !== 16) throw new Error(`int128 must be 16 bytes, got ${value.length}`);
    this.push(value);
  }

  writeInt256(value: Buffer): void {
    if (value.length !== 32) throw new Error(`int256 must be 32 bytes, got ${value.length}`);
    this.push(value);
  }

  writeBytes(value: Buffer): void {
    let headerLen: number;
    if (value.length < 254) {
      const header = Buffer.alloc(1);
      header[0] = value.length;
      this.push(header);
      headerLen = 1;
    } else {
      const header = Buffer.alloc(4);
      header[0] = 254;
      header[1] = value.length & 0xff;
      header[2] = (value.length >> 8) & 0xff;
      header[3] = (value.length >> 16) & 0xff;
      this.push(header);
      headerLen = 4;
    }
    this.push(value);
    // Pad to 4-byte alignment
    const totalLen = headerLen + value.length;
    const padding = (4 - (totalLen % 4)) % 4;
    if (padding > 0) {
      this.push(Buffer.alloc(padding));
    }
  }

  writeString(value: string): void {
    this.writeBytes(Buffer.from(value, 'utf-8'));
  }

  writeBool(value: boolean): void {
    this.writeUInt(value ? BOOL_TRUE_ID : BOOL_FALSE_ID);
  }

  writeVector(items: unknown[], itemType: TLFieldType): void {
    this.writeUInt(VECTOR_ID);
    this.writeInt(items.length);
    for (const item of items) {
      this.writeField(item, itemType);
    }
  }

  writeConstructorId(id: number): void {
    this.writeUInt(id);
  }

  /**
   * Serialize a TL object by its _type, writing constructor ID + fields.
   * boxed=true writes the constructor ID prefix.
   */
  writeObject(obj: Record<string, unknown>, boxed = true): void {
    const typeName = obj['_type'] as string;
    if (!typeName) throw new Error('TL object must have _type field');

    const schema = TL_SCHEMA[typeName];
    if (!schema) throw new Error(`Unknown TL type: ${typeName}`);

    if (boxed) {
      this.writeConstructorId(schema.id);
    }

    // Compute flags before writing
    this.writeFields(obj, schema);
  }

  private writeFields(obj: Record<string, unknown>, schema: TLConstructorDef): void {
    // First pass: compute flags values
    const flagValues: Record<string, number> = {};
    for (const field of schema.fields) {
      if (field.type === 'int' && field.name.toLowerCase().includes('flag')) {
        // Check if this is an explicit flags field
        const isFlags = schema.fields.some((f) => f.flag?.field === field.name);
        if (isFlags) {
          let flags = 0;
          for (const f of schema.fields) {
            if (f.flag?.field === field.name && obj[f.name] !== undefined && obj[f.name] !== null) {
              flags |= 1 << f.flag.bit;
            }
          }
          flagValues[field.name] = flags;
        }
      }
    }

    for (const field of schema.fields) {
      // Check if this is a flag field we computed
      if (field.name in flagValues) {
        this.writeInt(flagValues[field.name]!);
        continue;
      }

      // Skip conditional fields that are not present
      if (field.flag) {
        const flagVal = flagValues[field.flag.field] ?? (obj[field.flag.field] as number) ?? 0;
        if (!(flagVal & (1 << field.flag.bit))) {
          continue;
        }
      }

      const value = obj[field.name];
      this.writeField(value, field.type);
    }
  }

  writeField(value: unknown, type: TLFieldType): void {
    if (typeof type === 'string') {
      switch (type) {
        case 'int':
          this.writeInt(value as number);
          break;
        case 'long':
          this.writeLong(value as bigint);
          break;
        case 'double':
          this.writeDouble(value as number);
          break;
        case 'int128':
          this.writeInt128(value as Buffer);
          break;
        case 'int256':
          this.writeInt256(value as Buffer);
          break;
        case 'string':
          this.writeString(value as string);
          break;
        case 'bytes':
          this.writeBytes(value as Buffer);
          break;
        case 'Bool':
          this.writeBool(value as boolean);
          break;
        case 'true':
          // bare true — presence is encoded by the flag bit, no data written
          break;
        default:
          throw new Error(`Unknown primitive type: ${type}`);
      }
    } else if ('vector' in type) {
      this.writeVector(value as unknown[], type.vector);
    } else if ('ref' in type) {
      // Reference to another TL type — must be a boxed object
      this.writeObject(value as Record<string, unknown>, true);
    }
  }

  private push(buf: Buffer): void {
    this.buffers.push(buf);
    this.totalLength += buf.length;
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.buffers, this.totalLength);
  }
}

/**
 * Serialize a TL object to a Buffer.
 */
export function serializeTLObject(obj: Record<string, unknown>, boxed = true): Buffer {
  const s = new TLSerializer();
  s.writeObject(obj, boxed);
  return s.toBuffer();
}
