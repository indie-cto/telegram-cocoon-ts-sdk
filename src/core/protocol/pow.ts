/**
 * Proof-of-Work solver for Cocoon proxy connections.
 *
 * Before TLS handshake, the proxy sends a PoW challenge:
 *   [4B LE magic=0x418e1291] [4B LE difficulty_bits] [16B salt]
 *
 * Client must find a nonce (uint64) such that SHA256(salt || nonce)
 * has at least `difficulty_bits` leading zero bits.
 *
 * Response format:
 *   [4B LE magic=0x01827319] [8B LE nonce]
 */

import crypto from 'node:crypto';

export const POW_CHALLENGE_MAGIC = 0x418e1291;
export const POW_RESPONSE_MAGIC = 0x01827319;
export const POW_CHALLENGE_SIZE = 24; // 4 + 4 + 16
export const POW_RESPONSE_SIZE = 12; // 4 + 8
const MAX_DIFFICULTY = 32;

export interface PowChallenge {
  difficultyBits: number;
  salt: Buffer;
}

export function parsePowChallenge(data: Buffer): PowChallenge {
  if (data.length < POW_CHALLENGE_SIZE) {
    throw new Error(
      `PoW challenge too short: ${data.length} bytes, expected ${POW_CHALLENGE_SIZE}`,
    );
  }

  const magic = data.readUInt32LE(0);
  if (magic !== POW_CHALLENGE_MAGIC) {
    throw new Error(
      `Invalid PoW magic: 0x${magic.toString(16)}, expected 0x${POW_CHALLENGE_MAGIC.toString(16)}`,
    );
  }

  const difficultyBits = data.readInt32LE(4);
  if (difficultyBits < 0 || difficultyBits > MAX_DIFFICULTY) {
    throw new Error(`PoW difficulty out of range: ${difficultyBits}`);
  }

  const salt = Buffer.alloc(16);
  data.copy(salt, 0, 8, 24);

  return { difficultyBits, salt };
}

/**
 * Check PoW: read first 8 bytes of hash as LE uint64,
 * count leading zeros of that value.
 *
 * The C++ implementation does:
 *   count_leading_zeroes_u64(*(uint64_t*)hash_bytes) >= difficulty
 * On x86 (LE), this reads hash[0..7] in LE order, making hash[7]
 * the most significant byte of the uint64.
 */
function checkPow(hash: Buffer, difficultyBits: number): boolean {
  // Read first 8 hash bytes as LE uint64, then count leading zeros
  // Leading zeros of LE uint64 → check bytes 7,6,5,... (MSB first)
  let remaining = difficultyBits;
  for (let i = 7; i >= 0 && remaining > 0; i--) {
    const byte = hash[i]!;
    if (remaining >= 8) {
      if (byte !== 0) return false;
      remaining -= 8;
    } else {
      // Check top `remaining` bits of this byte
      const mask = 0xff << (8 - remaining);
      if ((byte & mask) !== 0) return false;
      remaining = 0;
    }
  }
  return true;
}

export function solvePow(challenge: PowChallenge): bigint {
  const { difficultyBits, salt } = challenge;

  if (difficultyBits === 0) return 0n;

  // Preallocate buffer: salt(16) + nonce(8)
  const input = Buffer.alloc(24);
  salt.copy(input, 0);

  for (let nonce = 0n; ; nonce++) {
    input.writeBigUInt64LE(nonce, 16);
    const hash = crypto.createHash('sha256').update(input).digest();
    if (checkPow(hash, difficultyBits)) {
      return nonce;
    }
  }
}

export function buildPowResponse(nonce: bigint): Buffer {
  const buf = Buffer.alloc(POW_RESPONSE_SIZE);
  buf.writeUInt32LE(POW_RESPONSE_MAGIC, 0);
  buf.writeBigUInt64LE(nonce, 4);
  return buf;
}
