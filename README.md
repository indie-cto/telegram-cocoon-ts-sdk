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
});
```

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
