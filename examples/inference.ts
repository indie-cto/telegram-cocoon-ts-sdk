/**
 * Run inference on Cocoon network.
 *
 * Usage:
 *   npx tsx --env-file=.env examples/inference.ts
 *
 * Optional env vars:
 *   NETWORK=mainnet|testnet (default: mainnet)
 *   PROXY_URL=host:port (skip discovery)
 *   MODEL=model-name (default: list available models first)
 *   PROMPT="your prompt" (default: "Hello!")
 *   STREAM=true|false (default: true)
 *   COCOON_TLS_CERT_PATH=/path/client-cert.pem
 *   COCOON_TLS_KEY_PATH=/path/client-key.pem
 *   AUTO_REGISTER_LONG_AUTH=false (advanced: disable automatic long-auth registration)
 *   TON_ENDPOINT=https://your-ton-rpc/jsonRPC
 *   TON_V4_ENDPOINT=https://mainnet-v4.tonhubapi.com
 */

import { Cocoon } from '../src/index.js';
import { readFileSync } from 'node:fs';

async function main() {
  const mnemonic = process.env.MNEMONIC;
  if (!mnemonic) {
    console.error('Error: MNEMONIC env var required (24 words)');
    process.exit(1);
  }

  const network = (process.env.NETWORK ?? 'mainnet') as 'mainnet' | 'testnet';
  const prompt = process.env.PROMPT ?? 'Hello! What models are available on Cocoon?';
  const stream = process.env.STREAM !== 'false';
  const tlsCertPath = process.env.COCOON_TLS_CERT_PATH;
  const tlsKeyPath = process.env.COCOON_TLS_KEY_PATH;
  const autoRegisterOnLongAuth = process.env.AUTO_REGISTER_LONG_AUTH !== 'false';
  const secret = process.env.SECRET;

  const tlsCert = tlsCertPath ? readFileSync(tlsCertPath, 'utf-8') : undefined;
  const tlsKey = tlsKeyPath ? readFileSync(tlsKeyPath, 'utf-8') : undefined;

  console.log(`Network: ${network}`);
  console.log(`Prompt: "${prompt}"`);
  console.log(`Stream: ${stream}\n`);

  const client = new Cocoon({
    wallet: mnemonic,
    network,
    secretString: secret,
    proxyUrl: process.env.PROXY_URL,
    tonEndpoint: process.env.TON_ENDPOINT,
    tonV4Endpoint: process.env.TON_V4_ENDPOINT,
    tlsCert,
    tlsKey,
    autoRegisterOnLongAuth,
  });

  try {
    // List available models
    console.log('Connecting and listing models...');
    const modelList = await client.models.list();
    console.log(`\nAvailable models (${modelList.data.length}):`);
    for (const m of modelList.data) {
      console.log(`  - ${m.id} (workers: ${m.active_workers}, coeff: ${m.coefficient_min}-${m.coefficient_max})`);
    }

    const model =
      process.env.MODEL ??
      modelList.data.find((m) => /qwen/i.test(m.id))?.id ??
      modelList.data[0]?.id;
    if (!model) {
      console.log('\nNo models available.');
      return;
    }

    console.log(`\nUsing model: ${model}`);
    console.log('---');

    if (stream) {
      // Streaming
      const streamResult = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        stream: true,
      });

      for await (const chunk of streamResult) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          process.stdout.write(delta);
        }
      }
      console.log('\n---');
    } else {
      // Non-streaming
      const result = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
      });

      console.log(result.choices[0]?.message.content);
      console.log('---');
      console.log(`Tokens: ${result.usage?.prompt_tokens} prompt + ${result.usage?.completion_tokens} completion = ${result.usage?.total_tokens} total`);
    }
  } finally {
    await client.disconnect();
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
