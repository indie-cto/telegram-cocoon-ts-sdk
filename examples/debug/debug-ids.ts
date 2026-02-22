/**
 * Debug: verify TL constructor IDs and analyze proxy response bytes.
 */
import { TL_SCHEMA, CONSTRUCTOR_ID_MAP, crc32 } from '../../src/core/tl/schema.js';

// Print all constructor IDs
console.log('=== All Constructor IDs ===');
for (const [name, def] of Object.entries(TL_SCHEMA)) {
  console.log('0x' + def.id.toString(16).padStart(8, '0'), name);
}

console.log('\n=== Check Unknown IDs ===');
console.log('0x418e1291:', CONSTRUCTOR_ID_MAP.get(0x418e1291));
console.log('0x91128e41:', CONSTRUCTOR_ID_MAP.get(0x91128e41));

// Response from previous debug session
const buf = Buffer.from('91128e4114000000b438ac04f3f630d4af11f94f06a621ce', 'hex');
console.log('\n=== Response Analysis ===');
console.log('Raw bytes:', buf.toString('hex'));
console.log('Length:', buf.length);

// Standard frame interpretation
console.log('\n--- If standard frame [size][seqno][payload] ---');
const size = buf.readUInt32LE(0);
console.log('size:', size, '(0x' + size.toString(16) + ')');
console.log('seqno:', buf.readInt32LE(4));

// Alternative: maybe first 4 bytes are something else
console.log('\n--- If bytes[4..7] are size (20 = 0x14) ---');
const altSize = buf.readUInt32LE(4); // = 0x14 = 20
console.log('bytes[4..7] as size:', altSize);
if (altSize === 0x14) {
  console.log('This is EXACTLY 20 bytes!');
  console.log('Need 8+20=28 bytes total for frame, have', buf.length - 4, 'from offset 4');
  // We'd have 20 bytes from offset 4: 14000000 + remaining
  // payload would start at offset 12 (skip size+seqno from offset 4)
}

// Try raw TL (no framing at all)
console.log('\n--- If no framing (raw TL) ---');
console.log('Constructor LE:', '0x' + buf.readUInt32LE(0).toString(16));

// What if it IS a frame but size is just 12?
console.log('\n--- What if frame with size=12 ---');
// 0c000000 in LE = 12
// But bytes 0..3 = 91128e41, not 0c000000

// Let me check: tcp.connected TL should be constructor_id(4) + id(8) = 12 bytes
console.log('tcp.connect ID: 0x' + TL_SCHEMA['tcp.connect'].id.toString(16).padStart(8, '0'));
console.log('tcp.connected ID: 0x' + TL_SCHEMA['tcp.connected'].id.toString(16).padStart(8, '0'));

// tcp.connected = constructor(4) + long(8) = 12 bytes
// So frame would be [0c000000][00000000][d641d663 + 8 bytes id]
// = 0c 00 00 00 00 00 00 00 d6 41 6d 63 ...

// Let me also check what 0x04ac38b4 is (bytes 8..11 LE)
const bytes8_11 = buf.readUInt32LE(8);
console.log('\nbytes[8..11] LE: 0x' + bytes8_11.toString(16).padStart(8, '0'));
console.log('Known?', CONSTRUCTOR_ID_MAP.get(bytes8_11));

// And bytes 12..15
if (buf.length >= 16) {
  const bytes12_15 = buf.readUInt32LE(12);
  console.log('bytes[12..15] LE: 0x' + bytes12_15.toString(16).padStart(8, '0'));
  console.log('Known?', CONSTRUCTOR_ID_MAP.get(bytes12_15));
}

// What if the server uses a different CRC32 or definition string?
console.log('\n=== CRC32 Variations ===');
const variants = [
  'tcp.connected id:long = tcp.Packet',
  'tcp.connected id:long = tcp.Packet;',
  'tcp.connected  id:long = tcp.Packet',
  'tcp.connected id : long = tcp.Packet',
];
for (const v of variants) {
  console.log('CRC32("' + v + '"):', '0x' + crc32(v).toString(16).padStart(8, '0'));
}
