# Cocoon TypeScript SDK

OpenAI-compatible TypeScript SDK for Telegram Cocoon.

This guide is intentionally step-by-step so you can get to a working request without reading Cocoon docs.

## Quickstart (From Zero to First Response)

### Prerequisites

- Node.js `>=18`
- `openssl`
- TON wallet mnemonic (24 words)
- Small TON balance for one-time setup transactions

### 1) Install dependencies

```bash
npm install
```

### 2) Create `.env`

```bash
cp .env.example .env
```

Edit `.env` and set only:

```env
MNEMONIC=your 24 words here
```

### 3) Run one-time setup

```bash
npx tsx --env-file=.env examples/setup.ts
```

What setup does for you:

- generates TLS client cert/key automatically,
- performs long-auth registration if needed,
- sets on-chain secret hash,
- prints ready-to-paste `.env` values.

Example final output:

```text
=== Setup Complete ===
Put these into your .env:
SECRET=...
PROXY_URL=91.108.4.11:8888
COCOON_TLS_CERT_PATH=/tmp/cocoon-client-xxxx.pem
COCOON_TLS_KEY_PATH=/tmp/cocoon-client-xxxx.key.pem
TON_V4_ENDPOINT=https://mainnet-v4.tonhubapi.com
```

### 4) Paste setup output into `.env`

Copy those lines exactly into `.env`.

Important: you do not need to find or create certificates manually.  
`examples/setup.ts` creates them and gives you the file paths.

### 5) Run inference

```bash
npx tsx --env-file=.env examples/inference.ts
```

You should see:

- connected models list,
- generated model output.

## Minimal SDK Usage

```ts
import { Cocoon } from 'cocoon-sdk';

const client = new Cocoon({
  wallet: process.env.MNEMONIC!,
  secretString: process.env.SECRET,
  proxyUrl: process.env.PROXY_URL,
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

## Defaults (Designed for the Common Path)

- `autoRegisterOnLongAuth` is enabled by default.
- If long auth is required, SDK can auto-submit registration transaction.
- You usually should not change advanced auth options.

## Useful Commands

- Setup once:
  - `npx tsx --env-file=.env examples/setup.ts`
- Inference test:
  - `npx tsx --env-file=.env examples/inference.ts`
- Discover proxies/models:
  - `npx tsx --env-file=.env examples/discover.ts`

## Troubleshooting

- `Proxy requires long auth` or secret mismatch:
  - run `examples/setup.ts` again and update `.env` with fresh output.
- TLS handshake closes immediately:
  - verify `COCOON_TLS_CERT_PATH` and `COCOON_TLS_KEY_PATH` exist and match.
- TON RPC `429`:
  - set `TON_V4_ENDPOINT=https://mainnet-v4.tonhubapi.com`.

## Security

- Never commit `.env`, mnemonics, secrets, or private keys.
- Treat `/tmp/cocoon-client-*.key.pem` as sensitive.

## License

MIT
