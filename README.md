# Cocoon TypeScript SDK

OpenAI-style TypeScript SDK for Telegram Cocoon.

- npm: `cocoon-sdk`
- repo: `https://github.com/indie-cto/telegram-cocoon-ts-sdk`

## Install

```bash
npm i cocoon-sdk
```

## Minimal Usage

```ts
import { Cocoon } from 'cocoon-sdk';

const client = new Cocoon({
  wallet: process.env.MNEMONIC!,        // 24 words
  secretString: process.env.SECRET!,    // from your setup flow
  proxyUrl: process.env.PROXY_URL,      // optional (discovery if omitted)
  tonV4Endpoint: process.env.TON_V4_ENDPOINT,
});

const models = await client.models.list();
const model = models.data[0]!.id;

const result = await client.chat.completions.create({
  model,
  messages: [{ role: 'user', content: 'Say OK' }],
});

console.log(result.choices[0]?.message.content);
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

## Important Defaults

- `autoRegisterOnLongAuth` default is `false` (safety-first).
- SDK does **not** submit on-chain registration tx unless you explicitly enable it.
- Recommended production path: run setup once, then use `SECRET` for short auth.

## One-Time Setup (Repo Helper Scripts)

The npm package is a **library only** (no bundled `scripts/setup.ts` files inside `node_modules`).

If you want the fully automated setup flow (cert/key generation + register + secret hash), run helper scripts from the GitHub repo:

```bash
git clone https://github.com/indie-cto/telegram-cocoon-ts-sdk.git
cd telegram-cocoon-ts-sdk
npm install
cp .env.example .env
# fill MNEMONIC in .env
npm run cocoon:setup
```

After setup, copy printed values into your app `.env`:
- `SECRET`
- `CLIENT_SC_ADDRESS`
- `PROXY_URL`
- `COCOON_TLS_CERT_PATH`
- `COCOON_TLS_KEY_PATH`

Quick links:

- `https://github.com/indie-cto/telegram-cocoon-ts-sdk`
- `scripts/setup.ts`
- `scripts/inference.ts`
- `scripts/topup.ts`
- `scripts/balance.ts`

Important:
- The intended path is: run `scripts/setup.ts` once, then reuse generated env values.
- Manual certificate generation is intentionally not documented here.
- If you skip setup, full flow usually will not work.

## If Stake Runs Out

Refill the same `client_sc` contract with a top-up transaction. You do not need a new `SECRET` or new TLS certs.

```bash
# in .env set at least:
# MNEMONIC=...
# CLIENT_SC_ADDRESS=...
# TOP_UP_TON=10
npm run cocoon:topup
```

Notes:
- `CLIENT_SC_ADDRESS` is printed by `npm run cocoon:setup`.
- If `CLIENT_SC_ADDRESS` is missing, `cocoon:topup` can try to resolve it via handshake (`SECRET` + TLS + proxy envs), but explicit `CLIENT_SC_ADDRESS` is more reliable.

## How To Monitor Balance

Use the helper script:

```bash
# in .env set:
# CLIENT_SC_ADDRESS=...
# (optional) MNEMONIC=... to also print wallet balance
npm run cocoon:balance
```

It prints:
- current `client_sc` balance
- live `minClientStake` from root config
- headroom/deficit relative to `minClientStake`
- wallet balance (if mnemonic provided)

## TON Balance Guidance

Two values matter:

1. Setup spend defaults:
- `REGISTER_TON=1.0`
- `CHANGE_SECRET_TON=0.7`
- plus fees

2. Network stake parameter (`minClientStake`) from root config:
- on mainnet, this can be much higher (for example 15 TON on Feb 22, 2026)

Practical guidance:

- smoke setup: typically `2-3 TON` can be enough
- stable usage: plan around `15-20 TON` total working balance
- verify live values with repo helper (`scripts/discover.ts`)

## Security

- Never commit mnemonic, secrets, or private keys.
- Treat TLS key files as sensitive.

## License

MIT
