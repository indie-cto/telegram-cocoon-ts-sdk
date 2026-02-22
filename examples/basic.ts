/**
 * Minimal SDK usage example (library-style).
 *
 * Usage:
 *   npx tsx --env-file=.env examples/basic.ts
 */

import { Cocoon } from '../src/index.js';

async function main() {
  const mnemonic = process.env.MNEMONIC;
  const secret = process.env.SECRET;
  if (!mnemonic || !secret) {
    throw new Error('Set MNEMONIC and SECRET in .env first');
  }

  const client = new Cocoon({
    wallet: mnemonic,
    secretString: secret,
    proxyUrl: process.env.PROXY_URL,
    tonV4Endpoint: process.env.TON_V4_ENDPOINT,
  });

  try {
    const models = await client.models.list();
    const model =
      process.env.MODEL ??
      models.data.find((m) => /qwen/i.test(m.id))?.id ??
      models.data[0]?.id;
    if (!model) {
      throw new Error('No models available');
    }

    const result = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'Say OK' }],
    });

    console.log(result.choices[0]?.message.content ?? '(empty response)');
  } finally {
    await client.disconnect();
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
