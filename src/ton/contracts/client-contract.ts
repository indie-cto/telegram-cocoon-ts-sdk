/**
 * CocoonClient smart contract wrapper.
 *
 * Handles client registration with a proxy and balance management.
 * The client contract is deployed per client-proxy pair.
 */

import { Address, beginCell, type Cell, toNano } from '@ton/ton';
import type { Sender } from '@ton/core';

// Opcodes from the Cocoon smart contracts
const OPCODES = {
  ownerClientRegister: 0xc45f9f3b,
  ownerClientChangeSecretHash: 0xa9357034,
  extClientTopUp: 0xf172e6c2,
} as const;

export class CocoonClientContract {
  constructor(private readonly address: Address) {}

  /**
   * Create a registration message body for the proxy.
   * This is sent to the client smart contract to register with a proxy.
   */
  static createRegisterBody(nonce: bigint, queryId = 0n): Cell {
    return beginCell()
      .storeUint(OPCODES.ownerClientRegister, 32)
      .storeUint(queryId, 64)
      .storeUint(nonce, 64)
      .endCell();
  }

  /**
   * Create a message body to change the secret hash.
   */
  static createChangeSecretHashBody(secretHash: Buffer, queryId = 0n): Cell {
    return beginCell()
      .storeUint(OPCODES.ownerClientChangeSecretHash, 32)
      .storeUint(queryId, 64)
      .storeBuffer(secretHash, 32)
      .endCell();
  }

  /**
   * Create a top-up message body.
   */
  static createTopUpBody(queryId = 0n): Cell {
    return beginCell().storeUint(OPCODES.extClientTopUp, 32).storeUint(queryId, 64).endCell();
  }

  /**
   * Send a registration transaction to the client contract.
   */
  async register(sender: Sender, nonce: bigint, amount = toNano('1')): Promise<void> {
    const body = CocoonClientContract.createRegisterBody(nonce);
    await sender.send({
      to: this.address,
      value: amount,
      body,
    });
  }

  /**
   * Top up the client contract balance.
   */
  async topUp(sender: Sender, amount: bigint): Promise<void> {
    const body = CocoonClientContract.createTopUpBody();
    await sender.send({
      to: this.address,
      value: amount,
      body,
    });
  }

  /**
   * Change the secret hash for short auth.
   */
  async changeSecretHash(
    sender: Sender,
    secretHash: Buffer,
    amount = toNano('0.05'),
  ): Promise<void> {
    const body = CocoonClientContract.createChangeSecretHashBody(secretHash);
    await sender.send({
      to: this.address,
      value: amount,
      body,
    });
  }
}
