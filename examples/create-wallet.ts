/**
 * Generate a new TON wallet for Cocoon.
 */
import { mnemonicNew, mnemonicToPrivateKey } from '@ton/crypto';
import { WalletContractV4 } from '@ton/ton';

async function main() {
  const mnemonic = await mnemonicNew(24);
  const keyPair = await mnemonicToPrivateKey(mnemonic);
  const wallet = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey });

  const address = wallet.address.toString({ bounceable: true, testOnly: false });
  const addressNonBounceable = wallet.address.toString({ bounceable: false, testOnly: false });

  console.log('=== New TON Wallet ===');
  console.log(`Mnemonic: ${mnemonic.join(' ')}`);
  console.log(`Address (bounceable): ${address}`);
  console.log(`Address (non-bounceable): ${addressNonBounceable}`);
}

main().catch(console.error);
