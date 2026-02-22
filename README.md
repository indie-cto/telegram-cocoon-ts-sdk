# Cocoon TypeScript SDK

OpenAI-compatible TypeScript SDK for Telegram Cocoon.

This guide is intentionally step-by-step so you can get to a working request without reading Cocoon docs.

## Quickstart (From Zero to First Response)

### Prerequisites

- Node.js `>=18`
- `openssl`
- TON wallet mnemonic (24 words)
- Small TON balance for one-time setup transactions

### TON Balance Requirements

Two different numbers matter:

1) **Setup transaction spend** (what setup sends from wallet by default):
- `REGISTER_TON=1.0` TON
- `CHANGE_SECRET_TON=0.7` TON
- plus network fees

2) **Protocol stake parameter** (`minClientStake`) from root config.
As of **February 22, 2026** on mainnet:
- `minClientStake = 15 TON`

So:
- **2-3 TON** is usually enough to complete setup transactions.
- For stable inference usage, plan for **~15-20 TON** total working balance (stake + buffer).
- Current live values can change; check with `npm run cocoon:discover`.

Optional for heavier usage:

- set `TOP_UP_TON` (for example `15` or `20`) to increase available client balance for inference traffic.

Is staking mandatory?

- For a first smoke test, **no manual top-up is required**.
- For normal/stable usage, **top-up is strongly recommended**.
- Practical target: set `TOP_UP_TON=15` (or higher) before running setup.

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
npm run cocoon:setup
```

What setup does for you:

- generates TLS client cert/key automatically,
- performs long-auth registration if needed,
- sets on-chain secret hash,
- prints ready-to-paste `.env` values.

If you want to include staking/top-up in the same setup run:

```bash
TOP_UP_TON=15 npm run cocoon:setup
```

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
`scripts/setup.ts` creates them and gives you the file paths.

### 5) Run inference

```bash
npm run cocoon:inference
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
  - `npm run cocoon:setup`
- Inference test:
  - `npm run cocoon:inference`
- Discover proxies/models:
  - `npm run cocoon:discover`
- Register only (advanced):
  - `npm run cocoon:register`
- Create wallet helper:
  - `npm run cocoon:create-wallet`
- Pure library example:
  - `npx tsx --env-file=.env examples/basic.ts`

## Troubleshooting

- `Proxy requires long auth` or secret mismatch:
  - run `npm run cocoon:setup` again and update `.env` with fresh output.
- TLS handshake closes immediately:
  - verify `COCOON_TLS_CERT_PATH` and `COCOON_TLS_KEY_PATH` exist and match.
- TON RPC `429`:
  - set `TON_V4_ENDPOINT=https://mainnet-v4.tonhubapi.com`.

## Security

- Never commit `.env`, mnemonics, secrets, or private keys.
- Treat `/tmp/cocoon-client-*.key.pem` as sensitive.

## License

MIT
