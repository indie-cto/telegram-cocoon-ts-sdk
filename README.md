# Cocoon TypeScript SDK

TypeScript SDK for [Telegram Cocoon](https://github.com/TelegramMessenger/cocoon) — decentralized GPU network for AI inference on TON blockchain.

Provides an **OpenAI-compatible API** over Cocoon's binary TL protocol.

## Install

```bash
npm install cocoon-sdk
```

## Quick Start

```typescript
import { Cocoon } from 'cocoon-sdk';

const client = new Cocoon({
  wallet: 'your 24 word mnemonic phrase here ...',
  network: 'mainnet',
});

// Chat completion (non-streaming)
const response = await client.chat.completions.create({
  model: 'deepseek-r1',
  messages: [{ role: 'user', content: 'Hello!' }],
});

console.log(response.choices[0].message.content);
```

## Streaming

```typescript
const stream = await client.chat.completions.create({
  model: 'llama-3.1-70b',
  messages: [{ role: 'user', content: 'Write a poem about the moon' }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || '');
}
```

## List Models

```typescript
const models = await client.models.list();
for (const model of models.data) {
  console.log(`${model.id} — ${model.active_workers} workers`);
}
```

## Configuration

```typescript
const client = new Cocoon({
  wallet: 'your 24 word mnemonic ...',   // Required
  network: 'mainnet',                     // 'mainnet' | 'testnet' (default: 'mainnet')
  proxyUrl: 'host:port',                  // Direct proxy (bypasses discovery)
  timeout: 120_000,                       // Request timeout in ms (default: 120s)
  tonEndpoint: 'https://your-ton-rpc',    // Optional TON RPC endpoint for on-chain ops
  tonV4Endpoint: 'https://mainnet-v4.tonhubapi.com', // Optional TON v4 endpoint for wallet tx sending
  secretString: process.env.SECRET,       // Recommended: secret from registration (short auth)
  tlsCert: process.env.COCOON_TLS_CERT_PEM, // Optional: RA-TLS/mTLS client cert
  tlsKey: process.env.COCOON_TLS_KEY_PEM,   // Optional: RA-TLS/mTLS client key
  autoRegisterOnLongAuth: false,          // If true, sends on-chain register tx when long auth is required
  longAuthRegisterAmountTon: '1',         // TON amount for auto long-auth register tx
});
```

## RA-TLS / mTLS

Mainnet Cocoon proxies may require RA-TLS client credentials.

You can provide credentials in two ways:

```typescript
import { Cocoon, FileAttestationProvider } from 'cocoon-sdk';

const client = new Cocoon({
  wallet: 'your 24 word mnemonic ...',
  proxyUrl: '91.108.4.11:8888',
  attestationProvider: new FileAttestationProvider(
    '/run/cocoon/client_cert.pem',
    '/run/cocoon/client_key.pem',
  ),
});
```

Or pass static PEM values with `tlsCert` + `tlsKey`.

If the connection closes during handshake, verify that:
- The client certificate and key are both present.
- The certificate is RA-TLS-compatible with proxy policy (not just generic self-signed TLS).

## Auth Modes

Cocoon has two auth modes:
- `short auth`: requires `secretString` that matches your on-chain secret hash.
- `long auth`: requires an on-chain register transaction with nonce from proxy.

If `secretString` is missing or mismatched, proxy can require long auth.
By default SDK does **not** send on-chain tx automatically. You can:
- set `autoRegisterOnLongAuth: true`, or
- run a one-time registration flow and then always use `secretString`.

## One-Time Setup

Use onboarding script to bootstrap wallet + secret:

```bash
npx tsx --env-file=.env examples/setup.ts
```

It will:
- prepare mTLS cert/key (or use your provided paths),
- run long-auth register tx if needed,
- set `secretHash` on-chain,
- print ready-to-copy `.env` values (`SECRET`, TLS paths, `PROXY_URL`).

If you hit `429` on public toncenter during registration, set `TON_V4_ENDPOINT`
(for example `https://mainnet-v4.tonhubapi.com`).

## Prerequisites

- **Node.js** >= 18
- A **TON wallet** with sufficient balance for inference requests
- The wallet must be registered with a Cocoon proxy (see [Cocoon docs](https://github.com/TelegramMessenger/cocoon/blob/main/docs/smart-contracts.md))

## How It Works

1. SDK connects to a Cocoon proxy via TCP/TLS
2. Performs handshake and authentication using the TL binary protocol
3. Sends inference requests as TL-serialized HTTP requests
4. Receives streaming responses via `queryAnswerPartEx` + `queryAnswerEx`
5. Parses responses into OpenAI-compatible types

## License

MIT
