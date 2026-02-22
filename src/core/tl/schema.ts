/**
 * TL Schema definitions with constructor IDs.
 *
 * Constructor IDs are CRC32 of the normalized TL definition string.
 * IDs with # suffix in the .tl file are explicit; others are computed.
 *
 * The schema maps _type names to their constructor ID and field definitions.
 */

export type TLFieldType =
  | 'int'
  | 'long'
  | 'double'
  | 'int128'
  | 'int256'
  | 'string'
  | 'bytes'
  | 'Bool'
  | 'true' // bare true (flag field present = true)
  | { vector: TLFieldType; bare?: boolean }
  | { ref: string }; // reference to another TL type by _type name

export interface TLFieldDef {
  name: string;
  type: TLFieldType;
  flag?: { field: string; bit: number }; // conditional field
}

export interface TLConstructorDef {
  id: number; // CRC32 constructor ID (uint32)
  fields: TLFieldDef[];
  isFunction?: boolean;
}

/**
 * CRC32 lookup table (IEEE polynomial)
 */
const crc32Table = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    if (c & 1) {
      c = 0xedb88320 ^ (c >>> 1);
    } else {
      c = c >>> 1;
    }
  }
  crc32Table[i] = c;
}

export function crc32(str: string): number {
  const bytes = Buffer.from(str, 'utf-8');
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = crc32Table[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Compute TL constructor ID from its definition line.
 * We normalize by removing comments and extra spaces.
 */
function tlId(definition: string): number {
  return crc32(definition.trim());
}

// --- TCP Layer ---
// From cocoon_api.tl:
// tcp.ping id:long = tcp.Packet;
// tcp.pong id:long = tcp.Packet;
// tcp.packet data:bytes = tcp.Packet;
// tcp.queryAnswer id:long data:bytes = tcp.Packet;
// tcp.queryError id:long code:int message:string = tcp.Packet;
// tcp.query id:long data:bytes = tcp.Packet;
// tcp.connected id:long = tcp.Packet;
// tcp.connect id:long = tcp.Packet;

export const TL_SCHEMA: Record<string, TLConstructorDef> = {
  // --- TCP Layer ---
  'tcp.ping': {
    id: tlId('tcp.ping id:long = tcp.Packet'),
    fields: [{ name: 'id', type: 'long' }],
  },
  'tcp.pong': {
    id: tlId('tcp.pong id:long = tcp.Packet'),
    fields: [{ name: 'id', type: 'long' }],
  },
  'tcp.packet': {
    id: tlId('tcp.packet data:bytes = tcp.Packet'),
    fields: [{ name: 'data', type: 'bytes' }],
  },
  'tcp.queryAnswer': {
    id: tlId('tcp.queryAnswer id:long data:bytes = tcp.Packet'),
    fields: [
      { name: 'id', type: 'long' },
      { name: 'data', type: 'bytes' },
    ],
  },
  'tcp.queryError': {
    id: tlId('tcp.queryError id:long code:int message:string = tcp.Packet'),
    fields: [
      { name: 'id', type: 'long' },
      { name: 'code', type: 'int' },
      { name: 'message', type: 'string' },
    ],
  },
  'tcp.query': {
    id: tlId('tcp.query id:long data:bytes = tcp.Packet'),
    fields: [
      { name: 'id', type: 'long' },
      { name: 'data', type: 'bytes' },
    ],
  },
  'tcp.connected': {
    id: tlId('tcp.connected id:long = tcp.Packet'),
    fields: [{ name: 'id', type: 'long' }],
  },
  'tcp.connect': {
    id: tlId('tcp.connect id:long = tcp.Packet'),
    fields: [{ name: 'id', type: 'long' }],
  },

  // --- Tokens ---
  tokensUsed: {
    id: tlId(
      'tokensUsed prompt_tokens_used:long cached_tokens_used:long completion_tokens_used:long reasoning_tokens_used:long total_tokens_used:long = TokensUsed',
    ),
    fields: [
      { name: 'promptTokensUsed', type: 'long' },
      { name: 'cachedTokensUsed', type: 'long' },
      { name: 'completionTokensUsed', type: 'long' },
      { name: 'reasoningTokensUsed', type: 'long' },
      { name: 'totalTokensUsed', type: 'long' },
    ],
  },

  // --- Client/Proxy Params ---
  // worker.params has explicit ID: #869c73ed
  'worker.params': {
    id: 0x869c73ed,
    fields: [
      { name: 'flags', type: 'int' },
      { name: 'workerOwnerAddress', type: 'string' },
      { name: 'model', type: 'string' },
      { name: 'coefficient', type: 'int' },
      { name: 'isTest', type: 'Bool', flag: { field: 'flags', bit: 0 } },
      { name: 'proxyCnt', type: 'int', flag: { field: 'flags', bit: 0 } },
      { name: 'maxActiveRequests', type: 'int', flag: { field: 'flags', bit: 0 } },
      { name: 'minProtoVersion', type: 'int', flag: { field: 'flags', bit: 1 } },
      { name: 'maxProtoVersion', type: 'int', flag: { field: 'flags', bit: 1 } },
    ],
  },

  // proxy.params has explicit ID: #d5c5609f
  'proxy.params': {
    id: 0xd5c5609f,
    fields: [
      { name: 'flags', type: 'int' },
      { name: 'proxyPublicKey', type: 'int256' },
      { name: 'proxyOwnerAddress', type: 'string' },
      { name: 'proxyScAddress', type: 'string' },
      { name: 'isTest', type: 'Bool', flag: { field: 'flags', bit: 0 } },
      { name: 'protoVersion', type: 'int', flag: { field: 'flags', bit: 1 } },
    ],
  },

  // client.params has explicit ID: #40fdca64
  'client.params': {
    id: 0x40fdca64,
    fields: [
      { name: 'flags', type: 'int' },
      { name: 'clientOwnerAddress', type: 'string' },
      { name: 'isTest', type: 'Bool', flag: { field: 'flags', bit: 0 } },
      { name: 'minProtoVersion', type: 'int', flag: { field: 'flags', bit: 1 } },
      { name: 'maxProtoVersion', type: 'int', flag: { field: 'flags', bit: 1 } },
    ],
  },

  // --- Auth ---
  'client.proxyConnectionAuthShort': {
    id: tlId(
      'client.proxyConnectionAuthShort secret_hash:int256 nonce:long = client.ProxyConnectionAuth',
    ),
    fields: [
      { name: 'secretHash', type: 'int256' },
      { name: 'nonce', type: 'long' },
    ],
  },
  'client.proxyConnectionAuthLong': {
    id: tlId('client.proxyConnectionAuthLong nonce:long = client.ProxyConnectionAuth'),
    fields: [{ name: 'nonce', type: 'long' }],
  },

  // --- Signed Payment ---
  'proxy.signedPayment': {
    id: tlId('proxy.signedPayment data:bytes = proxy.SignedPayment'),
    fields: [{ name: 'data', type: 'bytes' }],
  },
  'proxy.signedPaymentEmpty': {
    id: tlId('proxy.signedPaymentEmpty = proxy.SignedPayment'),
    fields: [],
  },

  // --- Connected To Proxy ---
  'client.connectedToProxy': {
    id: tlId(
      'client.connectedToProxy params:proxy.params client_sc_address:string auth:client.ProxyConnectionAuth signed_payment:proxy.SignedPayment = client.ConnectedToProxy',
    ),
    fields: [
      { name: 'params', type: { ref: 'proxy.params' } },
      { name: 'clientScAddress', type: 'string' },
      { name: 'auth', type: { ref: 'client.ProxyConnectionAuth' } },
      { name: 'signedPayment', type: { ref: 'proxy.SignedPayment' } },
    ],
  },

  // --- Auth Responses ---
  'client.authorizationWithProxySuccess': {
    id: tlId(
      'client.authorizationWithProxySuccess signed_payment:proxy.SignedPayment tokens_committed_to_db:long max_tokens:long = client.AuthorizationWithProxy',
    ),
    fields: [
      { name: 'signedPayment', type: { ref: 'proxy.SignedPayment' } },
      { name: 'tokensCommittedToDb', type: 'long' },
      { name: 'maxTokens', type: 'long' },
    ],
  },
  'client.authorizationWithProxyFailed': {
    id: tlId(
      'client.authorizationWithProxyFailed error_code:int error:string = client.AuthorizationWithProxy',
    ),
    fields: [
      { name: 'errorCode', type: 'int' },
      { name: 'error', type: 'string' },
    ],
  },

  // --- Query Final Info ---
  'client.queryFinalInfo': {
    id: tlId(
      'client.queryFinalInfo flags:# tokens_used:tokensUsed worker_debug:flags.0?string proxy_debug:flags.0?string proxy_start_time:flags.1?double proxy_end_time:flags.1?double worker_start_time:flags.1?double worker_end_time:flags.1?double = client.QueryFinalInfo',
    ),
    fields: [
      { name: 'flags', type: 'int' },
      { name: 'tokensUsed', type: { ref: 'tokensUsed' } },
      { name: 'workerDebug', type: 'string', flag: { field: 'flags', bit: 0 } },
      { name: 'proxyDebug', type: 'string', flag: { field: 'flags', bit: 0 } },
      { name: 'proxyStartTime', type: 'double', flag: { field: 'flags', bit: 1 } },
      { name: 'proxyEndTime', type: 'double', flag: { field: 'flags', bit: 1 } },
      { name: 'workerStartTime', type: 'double', flag: { field: 'flags', bit: 1 } },
      { name: 'workerEndTime', type: 'double', flag: { field: 'flags', bit: 1 } },
    ],
  },

  // --- Query Answer Ex variants ---
  // Legacy variants (still sent by some proxy paths):
  'client.queryAnswer': {
    id: tlId(
      'client.queryAnswer answer:bytes is_completed:Bool request_id:int256 request_tokens_used:tokensUsed = client.QueryAnswer',
    ),
    fields: [
      { name: 'answer', type: 'bytes' },
      { name: 'isCompleted', type: 'Bool' },
      { name: 'requestId', type: 'int256' },
      { name: 'requestTokensUsed', type: { ref: 'tokensUsed' } },
    ],
  },
  'client.queryAnswerError': {
    id: tlId(
      'client.queryAnswerError error_code:int error:string request_id:int256 request_tokens_used:tokensUsed = client.QueryAnswer',
    ),
    fields: [
      { name: 'errorCode', type: 'int' },
      { name: 'error', type: 'string' },
      { name: 'requestId', type: 'int256' },
      { name: 'requestTokensUsed', type: { ref: 'tokensUsed' } },
    ],
  },
  'client.queryAnswerPart': {
    id: tlId(
      'client.queryAnswerPart answer:bytes is_completed:Bool request_id:int256 request_tokens_used:tokensUsed = client.QueryAnswerPart',
    ),
    fields: [
      { name: 'answer', type: 'bytes' },
      { name: 'isCompleted', type: 'Bool' },
      { name: 'requestId', type: 'int256' },
      { name: 'requestTokensUsed', type: { ref: 'tokensUsed' } },
    ],
  },
  'client.queryAnswerPartError': {
    id: tlId(
      'client.queryAnswerPartError error_code:int error:string request_id:int256 request_tokens_used:tokensUsed = client.QueryAnswerPart',
    ),
    fields: [
      { name: 'errorCode', type: 'int' },
      { name: 'error', type: 'string' },
      { name: 'requestId', type: 'int256' },
      { name: 'requestTokensUsed', type: { ref: 'tokensUsed' } },
    ],
  },

  'client.queryAnswerEx': {
    id: tlId(
      'client.queryAnswerEx request_id:int256 answer:bytes flags:# final_info:flags.0?client.queryFinalInfo = client.QueryAnswerEx',
    ),
    fields: [
      { name: 'requestId', type: 'int256' },
      { name: 'answer', type: 'bytes' },
      { name: 'flags', type: 'int' },
      {
        name: 'finalInfo',
        type: { ref: 'client.queryFinalInfo' },
        flag: { field: 'flags', bit: 0 },
      },
    ],
  },
  'client.queryAnswerErrorEx': {
    id: tlId(
      'client.queryAnswerErrorEx request_id:int256 error_code:int error:string flags:# final_info:flags.0?client.queryFinalInfo = client.QueryAnswerEx',
    ),
    fields: [
      { name: 'requestId', type: 'int256' },
      { name: 'errorCode', type: 'int' },
      { name: 'error', type: 'string' },
      { name: 'flags', type: 'int' },
      {
        name: 'finalInfo',
        type: { ref: 'client.queryFinalInfo' },
        flag: { field: 'flags', bit: 0 },
      },
    ],
  },
  'client.queryAnswerPartEx': {
    id: tlId(
      'client.queryAnswerPartEx request_id:int256 answer:bytes flags:# final_info:flags.0?client.queryFinalInfo = client.QueryAnswerEx',
    ),
    fields: [
      { name: 'requestId', type: 'int256' },
      { name: 'answer', type: 'bytes' },
      { name: 'flags', type: 'int' },
      {
        name: 'finalInfo',
        type: { ref: 'client.queryFinalInfo' },
        flag: { field: 'flags', bit: 0 },
      },
    ],
  },

  // --- Worker Types V2 ---
  // client.workerInstanceV2 has explicit ID: #3ea93d00
  'client.workerInstanceV2': {
    id: 0x3ea93d00,
    fields: [
      { name: 'flags', type: 'int' },
      { name: 'coefficient', type: 'int' },
      { name: 'activeRequests', type: 'int' },
      { name: 'maxActiveRequests', type: 'int' },
    ],
  },
  'client.workerTypeV2': {
    // NOTE: Telegram TL canonical CRC for vector fields uses "vector T" syntax.
    // Equivalent canonical form:
    // "client.workerTypeV2 name:string workers:vector client.workerInstanceV2 = client.WorkerTypeV2"
    id: 0xb27d8197,
    fields: [
      { name: 'name', type: 'string' },
      { name: 'workers', type: { vector: { ref: 'client.workerInstanceV2' }, bare: true } },
    ],
  },
  'client.workerTypesV2': {
    // Canonical form:
    // "client.workerTypesV2 types:vector client.workerTypeV2 = client.WorkerTypesV2"
    id: 0x0cf0dc67,
    fields: [{ name: 'types', type: { vector: { ref: 'client.workerTypeV2' }, bare: true } }],
  },

  // --- Payment ---
  'client.paymentStatus': {
    id: tlId(
      'client.paymentStatus signed_payment:proxy.SignedPayment db_tokens:long max_tokens:long = client.PaymentStatus',
    ),
    fields: [
      { name: 'signedPayment', type: { ref: 'proxy.SignedPayment' } },
      { name: 'dbTokens', type: 'long' },
      { name: 'maxTokens', type: 'long' },
    ],
  },

  // Payment request from proxy to client (may be sent during query flow).
  'proxy.clientRequestPayment': {
    id: tlId(
      'proxy.clientRequestPayment request_id:int256 signed_payment:proxy.SignedPayment db_tokens:long max_tokens:long request_tokens:long = proxy.WorkerRequestPayment',
    ),
    fields: [
      { name: 'requestId', type: 'int256' },
      { name: 'signedPayment', type: { ref: 'proxy.SignedPayment' } },
      { name: 'dbTokens', type: 'long' },
      { name: 'maxTokens', type: 'long' },
      { name: 'requestTokens', type: 'long' },
    ],
  },

  'client.refund': {
    id: tlId('client.refund data:bytes = client.Refund'),
    fields: [{ name: 'data', type: 'bytes' }],
  },
  'client.refundRejected': {
    id: tlId('client.refundRejected active_queries:long = client.Refund'),
    fields: [{ name: 'activeQueries', type: 'long' }],
  },

  // --- HTTP ---
  'http.header': {
    id: tlId('http.header name:string value:string = http.Header'),
    fields: [
      { name: 'name', type: 'string' },
      { name: 'value', type: 'string' },
    ],
  },
  'http.response': {
    // Canonical vector form for CRC:
    // "http.response http_version:string status_code:int reason:string headers:vector http.header payload:bytes = http.Response"
    id: 0x1cd0c42b,
    fields: [
      { name: 'httpVersion', type: 'string' },
      { name: 'statusCode', type: 'int' },
      { name: 'reason', type: 'string' },
      { name: 'headers', type: { vector: { ref: 'http.header' }, bare: true } },
      { name: 'payload', type: 'bytes' },
    ],
  },
  'http.request': {
    // Canonical vector form for CRC:
    // "http.request method:string url:string http_version:string headers:vector http.header payload:bytes = http.Response"
    id: 0x47492de5,
    fields: [
      { name: 'method', type: 'string' },
      { name: 'url', type: 'string' },
      { name: 'httpVersion', type: 'string' },
      { name: 'headers', type: { vector: { ref: 'http.header' }, bare: true } },
      { name: 'payload', type: 'bytes' },
    ],
    isFunction: true,
  },

  // --- Root Config ---
  'rootConfig.registeredProxy': {
    id: tlId('rootConfig.registeredProxy seqno:int address:string = rootConfig.RegisteredProxy'),
    fields: [
      { name: 'seqno', type: 'int' },
      { name: 'address', type: 'string' },
    ],
  },

  // --- Functions ---
  'client.connectToProxy': {
    id: tlId(
      'client.connectToProxy params:client.params min_config_version:int = client.ConnectedToProxy',
    ),
    fields: [
      { name: 'params', type: { ref: 'client.params' } },
      { name: 'minConfigVersion', type: 'int' },
    ],
    isFunction: true,
  },
  'client.authorizeWithProxyShort': {
    id: tlId('client.authorizeWithProxyShort data:bytes = client.AuthorizationWithProxy'),
    fields: [{ name: 'data', type: 'bytes' }],
    isFunction: true,
  },
  'client.authorizeWithProxyLong': {
    id: tlId('client.authorizeWithProxyLong = client.AuthorizationWithProxy'),
    fields: [],
    isFunction: true,
  },
  'client.runQueryEx': {
    id: tlId(
      'client.runQueryEx model_name:string query:bytes max_coefficient:int max_tokens:int timeout:double request_id:int256 min_config_version:int flags:# enable_debug:flags.0?Bool = client.QueryAnswerEx',
    ),
    fields: [
      { name: 'modelName', type: 'string' },
      { name: 'query', type: 'bytes' },
      { name: 'maxCoefficient', type: 'int' },
      { name: 'maxTokens', type: 'int' },
      { name: 'timeout', type: 'double' },
      { name: 'requestId', type: 'int256' },
      { name: 'minConfigVersion', type: 'int' },
      { name: 'flags', type: 'int' },
      { name: 'enableDebug', type: 'Bool', flag: { field: 'flags', bit: 0 } },
    ],
    isFunction: true,
  },
  'client.getWorkerTypesV2': {
    id: tlId('client.getWorkerTypesV2 = client.WorkerTypesV2'),
    fields: [],
    isFunction: true,
  },
  'client.updatePaymentStatus': {
    id: tlId('client.updatePaymentStatus = client.PaymentStatus'),
    fields: [],
    isFunction: true,
  },
  'client.requestRefund': {
    id: tlId('client.requestRefund = client.Refund'),
    fields: [],
    isFunction: true,
  },
};

// Build reverse lookup: constructor ID → type name
export const CONSTRUCTOR_ID_MAP: Map<number, string> = new Map();
for (const [name, def] of Object.entries(TL_SCHEMA)) {
  CONSTRUCTOR_ID_MAP.set(def.id, name);
}

// Polymorphic type → concrete constructors
export const POLYMORPHIC_TYPES: Record<string, string[]> = {
  'tcp.Packet': [
    'tcp.ping',
    'tcp.pong',
    'tcp.packet',
    'tcp.queryAnswer',
    'tcp.queryError',
    'tcp.query',
    'tcp.connected',
    'tcp.connect',
  ],
  'client.ProxyConnectionAuth': [
    'client.proxyConnectionAuthShort',
    'client.proxyConnectionAuthLong',
  ],
  'proxy.SignedPayment': ['proxy.signedPayment', 'proxy.signedPaymentEmpty'],
  'client.AuthorizationWithProxy': [
    'client.authorizationWithProxySuccess',
    'client.authorizationWithProxyFailed',
  ],
  'client.QueryAnswerEx': [
    'client.queryAnswerEx',
    'client.queryAnswerErrorEx',
    'client.queryAnswerPartEx',
  ],
  'client.Refund': ['client.refund', 'client.refundRejected'],
};
