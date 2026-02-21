# Project Guidelines for Claude

## Project Overview

TypeScript SDK for Telegram Cocoon — decentralized GPU network for AI inference on TON blockchain.
Provides an OpenAI-compatible API over Cocoon's binary TL protocol.

## Tech Stack

- **Language**: TypeScript (strict mode)
- **Runtime**: Node.js >= 18
- **Build**: tsup (CJS + ESM + d.ts)
- **Testing**: Vitest
- **Blockchain**: TON (@ton/ton, @ton/core, @ton/crypto)
- **Protocol**: Custom binary TL over TCP/TLS

## Development Commands

```bash
npm install          # Install dependencies
npm run build        # Build CJS + ESM + d.ts
npm run test         # Run tests
npm run typecheck    # TypeScript type checking
npm run lint         # ESLint
npm run format       # Prettier
```

## File Organization

```
src/
  index.ts                      # Public exports
  client.ts                     # Cocoon class (main entry point)
  core/
    error.ts                    # Error classes
    streaming.ts                # Stream<T> async iterable
    tl/
      schema.ts                 # TL constructor IDs and field definitions
      serializer.ts             # JS objects → TL binary
      deserializer.ts           # TL binary → JS objects
      types.ts                  # TypeScript interfaces for TL objects
    protocol/
      connection.ts             # TCP/TLS with framing [size][seqno][payload]
      handshake.ts              # tcp_connect + client_connectToProxy
      session.ts                # Auth, keepalive, query dispatch
  resources/
    chat/completions.ts         # chat.completions.create()
    models/models.ts            # models.list()
  types/
    chat.ts                     # OpenAI-compatible chat types
    models.ts                   # Model types
    common.ts                   # Usage, FinishReason
  ton/
    wallet.ts                   # MnemonicWallet
    discovery.ts                # Root Contract → proxy discovery
    contracts/
      root.ts                   # CocoonRoot wrapper
      client-contract.ts        # CocoonClient registration
tests/
  unit/
    tl-serializer.test.ts       # TL round-trip tests
    streaming.test.ts           # Stream<T> tests
```

## Code Style & Conventions

- Files: `kebab-case.ts`
- Classes: `PascalCase`
- Functions/variables: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE`
- TL type names use dot notation: `tcp.ping`, `client.params`
- TL field names in TS use camelCase (not snake_case from .tl)

## Testing Requirements

- Write tests for new functionality
- Ensure existing tests pass before committing
- TL serializer/deserializer must have round-trip tests for all types

## Git Workflow

- Use conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`

## Common Mistakes to Avoid

- NEVER commit `.env` files or mnemonics
- NEVER hardcode wallet keys or secrets
- ALWAYS run `npm run typecheck && npm run test && npm run lint` before committing
- DO NOT add new dependencies without discussing first
- TL padding must align to 4 bytes for string/bytes fields

## Architecture Notes

- TL schema derived from cocoon_api.tl at github.com/TelegramMessenger/cocoon
- Frame format: [4b LE size][4b LE seqno][payload] — size is payload length only
- Handshake: tcp.connect → tcp.connected → client.connectToProxy (as tcp.query) → client.connectedToProxy
- Auth: short (secret hash match) or long (blockchain registration)
- Queries: client.runQueryEx wraps an http.request TL object
- Responses: client.queryAnswerPartEx (streaming) + client.queryAnswerEx (final)
- Constructor IDs with # in .tl file are explicit hex values; others use CRC32

## Verification Steps

1. `npm run typecheck` — TypeScript strict mode
2. `npm run test` — Vitest tests
3. `npm run lint` — ESLint
4. `npm run build` — CJS + ESM + d.ts output
