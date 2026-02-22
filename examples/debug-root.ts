import { Address, Cell, Dictionary, TonClient } from '@ton/ton';

async function main() {
  const addr = process.argv[2] ?? 'EQCns7bYSp0igFvS1wpb5wsZjCKCV19MD5AVzI4EyxsnU73k';
  const client = new TonClient({ endpoint: 'https://toncenter.com/api/v2/jsonRPC' });
  const state = await client.getContractState(Address.parse(addr));
  if (!state.data) { console.log('no data'); return; }

  const cell = Cell.fromBoc(Buffer.from(state.data))[0]!;
  const cs = cell.beginParse();
  console.log(`total: ${cs.remainingBits} bits, ${cs.remainingRefs} refs`);

  const owner = cs.loadAddress();
  console.log(`owner: ${owner.toString()}`);
  console.log(`after addr: ${cs.remainingBits} bits, ${cs.remainingRefs} refs`);

  const version = cs.loadUint(32);
  console.log(`version: ${version}`);
  console.log(`after version: ${cs.remainingBits} bits, ${cs.remainingRefs} refs`);

  // Data ref
  const data = cs.loadRef().beginParse();
  console.log(`\ndata ref: ${data.remainingBits} bits, ${data.remainingRefs} refs`);

  // Parse data: proxyHashes dict, registeredProxies dict, lastProxySeqno, workerHashes, modelHashes
  // Skip proxyHashes
  const hasProxyH = data.loadBit();
  console.log(`proxyHashes: ${hasProxyH ? 'present' : 'empty'}`);
  if (hasProxyH) data.loadRef();

  // registeredProxies
  const hasProxies = data.loadBit();
  console.log(`registeredProxies: ${hasProxies ? 'present' : 'empty'}`);
  if (hasProxies) {
    const proxiesRef = data.loadRef();
    try {
      const dict = Dictionary.loadDirect<number, string>(
        Dictionary.Keys.Uint(32),
        {
          serialize: () => { throw new Error(''); },
          parse: (src) => {
            src.loadBit();
            const len = src.loadUint(7);
            return src.loadBuffer(len).toString('utf-8');
          },
        },
        proxiesRef,
      );
      for (const [k, v] of dict) console.log(`  [${k}] "${v}"`);
    } catch (e: any) {
      console.log(`  parse failed: ${e.message}`);
    }
  }

  const seqno = data.loadUint(32);
  console.log(`lastProxySeqno: ${seqno}`);

  // workerHashes
  const hasWorkerH = data.loadBit();
  console.log(`workerHashes: ${hasWorkerH ? 'present' : 'empty'}`);
  if (hasWorkerH) data.loadRef();

  // modelHashes
  const hasModelH = data.loadBit();
  console.log(`modelHashes: ${hasModelH ? 'present' : 'empty'}`);
  if (hasModelH) data.loadRef();

  console.log(`data remaining: ${data.remainingBits} bits, ${data.remainingRefs} refs`);

  // Params ref
  const pcs = cs.loadRef().beginParse();
  console.log(`\nparams ref: ${pcs.remainingBits} bits, ${pcs.remainingRefs} refs`);
  const sv = pcs.loadUint(8);
  console.log(`structVersion: ${sv}`);
  const pv = pcs.loadUint(32);
  console.log(`paramsVersion: ${pv}`);
  const uid = pcs.loadUint(32);
  console.log(`uniqueId: ${uid}`);
  const isTest = pcs.loadBit();
  console.log(`isTest: ${isTest}`);
  const price = pcs.loadCoins();
  console.log(`pricePerToken: ${price}`);
  const wfee = pcs.loadCoins();
  console.log(`workerFeePerToken: ${wfee}`);
}

main().catch(console.error);
