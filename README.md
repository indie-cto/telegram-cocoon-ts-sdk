# Cocoon TypeScript SDK

OpenAI-compatible TypeScript SDK for Telegram Cocoon.

Цель этого README: пройти путь до рабочего инференса без чтения внешней документации.

## 5 минут до первого ответа

Что нужно:
- Node.js `>=18`
- `openssl`
- TON кошелек (24 слова) с небольшим балансом

### 1. Установить зависимости

```bash
npm install
```

### 2. Создать `.env`

```bash
cp .env.example .env
```

Открой `.env` и заполни только:
- `MNEMONIC=...` (твои 24 слова)

Остальное пока не трогай.

### 3. Запустить one-time setup

```bash
npx tsx --env-file=.env examples/setup.ts
```

Этот шаг делает все автоматически:
- генерирует TLS сертификат и ключ клиента,
- регистрирует long-auth при необходимости,
- выставляет on-chain secret hash,
- печатает готовые значения для `.env`.

Пример финального вывода:

```text
=== Setup Complete ===
Put these into your .env:
SECRET=...
PROXY_URL=91.108.4.11:8888
COCOON_TLS_CERT_PATH=/tmp/cocoon-client-xxxx.pem
COCOON_TLS_KEY_PATH=/tmp/cocoon-client-xxxx.key.pem
TON_V4_ENDPOINT=https://mainnet-v4.tonhubapi.com
```

### 4. Вставить значения в `.env`

Скопируй строки из вывода setup в `.env`.

Важно:
- сертификаты **не нужно где-то искать**,
- они уже сгенерированы setup-скриптом,
- пути будут вида `/tmp/cocoon-client-...pem`.

### 5. Запустить инференс

```bash
npx tsx --env-file=.env examples/inference.ts
```

Если все ок, увидишь список моделей и ответ LLM.

## Минимальное использование SDK

```ts
import { Cocoon } from 'cocoon-sdk';

const client = new Cocoon({
  wallet: process.env.MNEMONIC!,
  network: 'mainnet',
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

## FAQ

### Где брать TLS сертификаты?

Нигде. В типичном сценарии `examples/setup.ts` генерирует их сам через `openssl` и печатает пути.

### Нужно ли самому генерировать `SECRET`?

Нет. Setup генерирует и синхронизирует его с on-chain `secretHash`.

### Можно использовать свои cert/key?

Да. Перед setup укажи:
- `COCOON_TLS_CERT_PATH=/path/to/cert.pem`
- `COCOON_TLS_KEY_PATH=/path/to/key.pem`

Тогда setup использует их, а не создаст новые.

### Что делать при `429` от TON RPC?

Добавь в `.env`:
- `TON_V4_ENDPOINT=https://mainnet-v4.tonhubapi.com`

### Что делать, если соединение закрывается на TLS handshake?

Проверь, что пути в:
- `COCOON_TLS_CERT_PATH`
- `COCOON_TLS_KEY_PATH`

указывают на существующие файлы и что cert/key парные.

## Security

- Не коммить `.env`, mnemonic, secret, приватные ключи.
- TLS ключи из `/tmp` считай временными и приватными.

## License

MIT
