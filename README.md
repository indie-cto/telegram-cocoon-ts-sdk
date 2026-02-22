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

After setup, copy printed values (`SECRET`, TLS paths, `PROXY_URL`) into your app env.

Quick links:

- `https://github.com/indie-cto/telegram-cocoon-ts-sdk`
- `scripts/setup.ts`
- `scripts/inference.ts`

Important for users integrating from another project:

- The intended path is to run `scripts/setup.ts` once and copy `SECRET` + TLS paths.
- Do **not** rely on ad-hoc certificate generation commands from agents.
- A generic command like `openssl req -x509 -newkey ec ...` is not the tested/default SDK path.

If you cannot run `scripts/setup.ts`, use this tested certificate generation format:

```bash
openssl genpkey -algorithm ed25519 -out /tmp/cocoon-client.key.pem
openssl req -x509 \
  -key /tmp/cocoon-client.key.pem \
  -out /tmp/cocoon-client-cert.pem \
  -days 1 \
  -subj "/C=AE/ST=DUBAI/O=TDLib Development/OU=Security/CN=localhost"
```

Then set:

```env
COCOON_TLS_CERT_PATH=/tmp/cocoon-client-cert.pem
COCOON_TLS_KEY_PATH=/tmp/cocoon-client.key.pem
```

Note: this only covers TLS material. You still need a valid `SECRET` (recommended via setup flow).

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
