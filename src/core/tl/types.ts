/**
 * TypeScript interfaces for TL objects used in the Cocoon protocol.
 * Derived from cocoon_api.tl schema.
 */

// --- Primitives ---

export type TLInt = number; // 32-bit signed
export type TLLong = bigint; // 64-bit signed
export type TLDouble = number; // 64-bit float
export type TLInt128 = Buffer; // 16 bytes
export type TLInt256 = Buffer; // 32 bytes
export type TLBytes = Buffer;
export type TLString = string;
export type TLBool = boolean;

// --- TCP Layer ---

export interface TcpPing {
  _type: 'tcp.ping';
  id: TLLong;
}

export interface TcpPong {
  _type: 'tcp.pong';
  id: TLLong;
}

export interface TcpPacket {
  _type: 'tcp.packet';
  data: TLBytes;
}

export interface TcpQueryAnswer {
  _type: 'tcp.queryAnswer';
  id: TLLong;
  data: TLBytes;
}

export interface TcpQueryError {
  _type: 'tcp.queryError';
  id: TLLong;
  code: TLInt;
  message: TLString;
}

export interface TcpQuery {
  _type: 'tcp.query';
  id: TLLong;
  data: TLBytes;
}

export interface TcpConnected {
  _type: 'tcp.connected';
  id: TLLong;
}

export interface TcpConnect {
  _type: 'tcp.connect';
  id: TLLong;
}

export type TcpPacketType =
  | TcpPing
  | TcpPong
  | TcpPacket
  | TcpQueryAnswer
  | TcpQueryError
  | TcpQuery
  | TcpConnected
  | TcpConnect;

// --- Client Params ---

export interface ClientParams {
  _type: 'client.params';
  flags: TLInt;
  clientOwnerAddress: TLString;
  isTest?: TLBool; // flags.0
  minProtoVersion?: TLInt; // flags.1
  maxProtoVersion?: TLInt; // flags.1
}

export interface ProxyParams {
  _type: 'proxy.params';
  flags: TLInt;
  proxyPublicKey: TLInt256;
  proxyOwnerAddress: TLString;
  proxyScAddress: TLString;
  isTest?: TLBool; // flags.0
  protoVersion?: TLInt; // flags.1
}

// --- Auth ---

export interface ClientProxyConnectionAuthShort {
  _type: 'client.proxyConnectionAuthShort';
  secretHash: TLInt256;
  nonce: TLLong;
}

export interface ClientProxyConnectionAuthLong {
  _type: 'client.proxyConnectionAuthLong';
  nonce: TLLong;
}

export type ClientProxyConnectionAuth =
  | ClientProxyConnectionAuthShort
  | ClientProxyConnectionAuthLong;

export interface ProxySignedPayment {
  _type: 'proxy.signedPayment';
  data: TLBytes;
}

export interface ProxySignedPaymentEmpty {
  _type: 'proxy.signedPaymentEmpty';
}

export type ProxySignedPaymentType = ProxySignedPayment | ProxySignedPaymentEmpty;

export interface ClientConnectedToProxy {
  _type: 'client.connectedToProxy';
  params: ProxyParams;
  clientScAddress: TLString;
  auth: ClientProxyConnectionAuth;
  signedPayment: ProxySignedPaymentType;
}

export interface ClientAuthorizationWithProxySuccess {
  _type: 'client.authorizationWithProxySuccess';
  signedPayment: ProxySignedPaymentType;
  tokensCommittedToDb: TLLong;
  maxTokens: TLLong;
}

export interface ClientAuthorizationWithProxyFailed {
  _type: 'client.authorizationWithProxyFailed';
  errorCode: TLInt;
  error: TLString;
}

export type ClientAuthorizationWithProxy =
  | ClientAuthorizationWithProxySuccess
  | ClientAuthorizationWithProxyFailed;

// --- Tokens ---

export interface TokensUsed {
  _type: 'tokensUsed';
  promptTokensUsed: TLLong;
  cachedTokensUsed: TLLong;
  completionTokensUsed: TLLong;
  reasoningTokensUsed: TLLong;
  totalTokensUsed: TLLong;
}

// --- Query Answers (Ex variants) ---

export interface ClientQueryFinalInfo {
  _type: 'client.queryFinalInfo';
  flags: TLInt;
  tokensUsed: TokensUsed;
  workerDebug?: TLString; // flags.0
  proxyDebug?: TLString; // flags.0
  proxyStartTime?: TLDouble; // flags.1
  proxyEndTime?: TLDouble; // flags.1
  workerStartTime?: TLDouble; // flags.1
  workerEndTime?: TLDouble; // flags.1
}

export interface ClientQueryAnswerEx {
  _type: 'client.queryAnswerEx';
  requestId: TLInt256;
  answer: TLBytes;
  flags: TLInt;
  finalInfo?: ClientQueryFinalInfo; // flags.0
}

export interface ClientQueryAnswerErrorEx {
  _type: 'client.queryAnswerErrorEx';
  requestId: TLInt256;
  errorCode: TLInt;
  error: TLString;
  flags: TLInt;
  finalInfo?: ClientQueryFinalInfo; // flags.0
}

export interface ClientQueryAnswerPartEx {
  _type: 'client.queryAnswerPartEx';
  requestId: TLInt256;
  answer: TLBytes;
  flags: TLInt;
  finalInfo?: ClientQueryFinalInfo; // flags.0
}

export type ClientQueryAnswerExType =
  | ClientQueryAnswerEx
  | ClientQueryAnswerErrorEx
  | ClientQueryAnswerPartEx;

// --- Worker Types ---

export interface ClientWorkerInstanceV2 {
  _type: 'client.workerInstanceV2';
  flags: TLInt;
  coefficient: TLInt;
  activeRequests: TLInt;
  maxActiveRequests: TLInt;
}

export interface ClientWorkerTypeV2 {
  _type: 'client.workerTypeV2';
  name: TLString;
  workers: ClientWorkerInstanceV2[];
}

export interface ClientWorkerTypesV2 {
  _type: 'client.workerTypesV2';
  types: ClientWorkerTypeV2[];
}

// --- Payment ---

export interface ClientPaymentStatus {
  _type: 'client.paymentStatus';
  signedPayment: ProxySignedPaymentType;
  dbTokens: TLLong;
  maxTokens: TLLong;
}

export interface ClientRefund {
  _type: 'client.refund';
  data: TLBytes;
}

export interface ClientRefundRejected {
  _type: 'client.refundRejected';
  activeQueries: TLLong;
}

// --- HTTP ---

export interface HttpHeader {
  _type: 'http.header';
  name: TLString;
  value: TLString;
}

export interface HttpResponse {
  _type: 'http.response';
  httpVersion: TLString;
  statusCode: TLInt;
  reason: TLString;
  headers: HttpHeader[];
  payload: TLBytes;
}

export interface HttpRequest {
  _type: 'http.request';
  method: TLString;
  url: TLString;
  httpVersion: TLString;
  headers: HttpHeader[];
  payload: TLBytes;
}

// --- Root Config ---

export interface RootConfigRegisteredProxy {
  _type: 'rootConfig.registeredProxy';
  seqno: TLInt;
  address: TLString;
}

export interface RootConfigConfigV5 {
  _type: 'rootConfig.configV5';
  rootOwnerAddress: TLString;
  proxyHashes: TLInt256[];
  registeredProxies: RootConfigRegisteredProxy[];
  lastProxySeqno: TLInt;
  workerHashes: TLInt256[];
  modelHashes: TLInt256[];
  version: TLInt;
  structVersion: TLInt;
  paramsVersion: TLInt;
  uniqueId: TLInt;
  isTest: TLInt;
  pricePerToken: TLLong;
  workerFeePerToken: TLLong;
  promptTokensPriceMultiplier: TLInt;
  cachedTokensPriceMultiplier: TLInt;
  completionTokensPriceMultiplier: TLInt;
  reasoningTokensPriceMultiplier: TLInt;
  proxyDelayBeforeClose: TLInt;
  clientDelayBeforeClose: TLInt;
  minProxyStake: TLLong;
  minClientStake: TLLong;
  proxyScCode: TLString;
  workerScCode: TLString;
  clientScCode: TLString;
}

// --- Functions (RPC calls) ---

export interface ClientConnectToProxy {
  _type: 'client.connectToProxy';
  params: ClientParams;
  minConfigVersion: TLInt;
}

export interface ClientAuthorizeWithProxyShort {
  _type: 'client.authorizeWithProxyShort';
  data: TLBytes;
}

export interface ClientAuthorizeWithProxyLong {
  _type: 'client.authorizeWithProxyLong';
}

export interface ClientRunQueryEx {
  _type: 'client.runQueryEx';
  modelName: TLString;
  query: TLBytes;
  maxCoefficient: TLInt;
  maxTokens: TLInt;
  timeout: TLDouble;
  requestId: TLInt256;
  minConfigVersion: TLInt;
  flags: TLInt;
  enableDebug?: TLBool; // flags.0
}

export interface ClientGetWorkerTypesV2 {
  _type: 'client.getWorkerTypesV2';
}

export interface ClientUpdatePaymentStatus {
  _type: 'client.updatePaymentStatus';
}

export interface ClientRequestRefund {
  _type: 'client.requestRefund';
}

// Union of all TL objects
export type TLObject =
  | TcpPacketType
  | ClientParams
  | ProxyParams
  | ClientProxyConnectionAuth
  | ProxySignedPaymentType
  | ClientConnectedToProxy
  | ClientAuthorizationWithProxy
  | TokensUsed
  | ClientQueryFinalInfo
  | ClientQueryAnswerExType
  | ClientWorkerInstanceV2
  | ClientWorkerTypeV2
  | ClientWorkerTypesV2
  | ClientPaymentStatus
  | HttpHeader
  | HttpResponse
  | HttpRequest
  | RootConfigRegisteredProxy
  | RootConfigConfigV5
  | ClientConnectToProxy
  | ClientAuthorizeWithProxyShort
  | ClientAuthorizeWithProxyLong
  | ClientRunQueryEx
  | ClientGetWorkerTypesV2
  | ClientUpdatePaymentStatus
  | ClientRequestRefund
  | ClientRefund
  | ClientRefundRejected;
