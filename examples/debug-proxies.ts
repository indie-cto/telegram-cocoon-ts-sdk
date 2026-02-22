/**
 * Debug: parse root contract cell trying different field orders.
 */
import { Address, Cell, Dictionary, TonClient } from '@ton/ton';

const rootAddr = 'EQBcXvP9DUA4k5tqUapcilt4kZnBzF0Ts7OW0Yp5FI0aN7g0';

async function main() {
  const client = new TonClient({ endpoint: 'https://toncenter.com/api/v2/jsonRPC' });
  const state = await client.getContractState(Address.parse(rootAddr));
  if (!state.data) { console.log('no data'); return; }

  const cell = Cell.fromBoc(Buffer.from(state.data))[0]!;

  // Try to parse each ref as a proxies dict independently
  for (let i = 0; i < cell.refs.length; i++) {
    console.log(`\n--- Trying ref[${i}] as proxies dict ---`);
    const ref = cell.refs[i]!;
    const rs = ref.beginParse();
    console.log(`${rs.remainingBits} bits, ${rs.remainingRefs} refs`);

    try {
      const dict = Dictionary.loadDirect<number, string>(
        Dictionary.Keys.Uint(32),
        {
          serialize: () => { throw new Error(''); },
          parse: (src) => {
            src.loadBit(); // type
            const len = src.loadUint(7);
            const buf = src.loadBuffer(len);
            return buf.toString('utf-8');
          },
        },
        ref,
      );
      console.log(`Success! Entries:`);
      for (const [key, val] of dict) {
        console.log(`  [${key}] "${val}"`);
      }
    } catch (e: any) {
      console.log(`Failed: ${e.message}`);
    }
  }

  // Also try: maybe the wrapper order is correct (data in a ref, not inline)
  console.log('\n\n--- Try wrapper order: addr, ref(data), version, ref(params) ---');
  const cs = cell.beginParse();
  const addr = cs.loadAddress();
  console.log(`addr: ${addr.toString()}`);
  console.log(`remaining: ${cs.remainingBits} bits, ${cs.remainingRefs} refs`);

  // What if the next bits are inline data, not version?
  // Read bits one at a time to find the version
  const cs2 = cell.beginParse();
  cs2.loadAddress();
  // Read next 67 bits
  const bits: number[] = [];
  for (let i = 0; i < 67; i++) {
    bits.push(cs2.loadBit() ? 1 : 0);
  }
  console.log(`67 bits after addr: ${bits.join('')}`);

  // Try interpreting as: version(32) + dict_flag + dict_flag + seqno(32) + dict_flag
  const v32 = parseInt(bits.slice(0, 32).join(''), 2);
  console.log(`If version first: v=${v32}, then bits: ${bits.slice(32).join('')}`);

  // Try: dict_flag + seqno(32) + dict_flag + dict_flag + version(32)
  const f1 = bits[0];
  const seqno = parseInt(bits.slice(1, 33).join(''), 2);
  const f2 = bits[33];
  const f3 = bits[34];
  const v = parseInt(bits.slice(35, 67).join(''), 2);
  console.log(`If dict(${f1}) seqno(${seqno}) dict(${f2}) dict(${f3}) version(${v})`);

  // Try: dict_flag + dict_flag + seqno(32) + dict_flag + version(32)
  const fa = bits[0];
  const fb = bits[1];
  const s2 = parseInt(bits.slice(2, 34).join(''), 2);
  const fc = bits[34];
  const v2 = parseInt(bits.slice(35, 67).join(''), 2);
  console.log(`If dict(${fa}) dict(${fb}) seqno(${s2}) dict(${fc}) version(${v2})`);

  // What if version(32) then dict_flag + dict_flag + dict_flag + seqno(32)?
  const v3 = parseInt(bits.slice(0, 32).join(''), 2);
  const fd = bits[32];
  const fe = bits[33];
  const ff = bits[34];
  const s3 = parseInt(bits.slice(35, 67).join(''), 2);
  console.log(`If version(${v3}) dict(${fd}) dict(${fe}) dict(${ff}) seqno(${s3})`);
}

main().catch(console.error);
