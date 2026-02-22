# Cocoon TypeScript SDK

OpenAI-compatible TypeScript client for [Telegram Cocoon](https://github.com/TelegramMessenger/cocoon).

If you use it as a dependency:

```bash
npm install cocoon-sdk
```

## Fast Start

Prerequisites:
- Node.js `>=18`
- TON wallet mnemonic (24 words)
- small TON balance for one-time registration
- `openssl` installed (used by setup script)

1) Install deps

```bash
npm install
```

2) Create `.env`

```bash
cp .env.example .env
```

Fill `MNEMONIC` in `.env`.

3) Run one-time setup

```bash
npx tsx --env-file=.env examples/setup.ts
```

This script:
- generates (or uses provided) TLS cert/key,
- performs long-auth registration if required,
- updates on-chain `secretHash`,
- prints ready values for `.env` (`SECRET`, `PROXY_URL`, TLS paths).

4) Run inference

```bash
npx tsx --env-file=.env examples/inference.ts
```

## Minimal SDK Usage

```ts
import { Cocoon } from 'cocoon-sdk';

const client = new Cocoon({
  wallet: process.env.MNEMONIC!,
  network: 'mainnet',
  secretString: process.env.SECRET,
  proxyUrl: process.env.PROXY_URL, // optional, discovery is used if omitted
  tonV4Endpoint: process.env.TON_V4_ENDPOINT,
});

const models = await client.models.list();
const model = models.data[0]!.id;

const res = await client.chat.completions.create({
  model,
  messages: [{ role: 'user', content: 'Say OK' }],
});

console.log(res.choices[0]?.message.content);
await client.disconnect();
```

## Streaming

```ts
const stream = await client.chat.completions.create({
  model: 'Qwen/Qwen3-32B',
  messages: [{ role: 'user', content: 'Write one short sentence' }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
}
```

## Config (Common)

- `wallet` (required): mnemonic (24 words)
- `network`: `mainnet` or `testnet` (default `mainnet`)
- `secretString`: required for short-auth flow
- `proxyUrl`: `host:port` (optional, skips discovery)
- `tonEndpoint`: optional TON JSON-RPC endpoint
- `tonV4Endpoint`: optional TON v4 endpoint (recommended for tx sending)
- `tlsCert` + `tlsKey`: optional mTLS PEM pair
- `attestationProvider`: dynamic TLS material provider
- `autoRegisterOnLongAuth`: auto-send long-auth register tx when needed

## Troubleshooting

- `Proxy requires long auth` / secret mismatch:
  - run `examples/setup.ts` once and use printed `SECRET`.
- connection closes during TLS handshake:
  - check `COCOON_TLS_CERT_PATH` and `COCOON_TLS_KEY_PATH`.
- public TON RPC returns `429`:
  - set `TON_V4_ENDPOINT` (example: `https://mainnet-v4.tonhubapi.com`).
- some models may not support `chat/completions` payload format:
  - call `models.list()` and choose a model that supports your request shape.

## Security

- Never commit `.env`, mnemonics, secrets, or private keys.
- Keep TLS key files private and short-lived.

## License

MIT
