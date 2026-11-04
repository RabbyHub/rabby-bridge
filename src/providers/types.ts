import type { ParsedBridgeCall } from '../calldata/types.js';
import type { BridgeBuildTxParams, BridgeQuoteListItem, BridgeQuoteListParams, BridgeTx } from '../quote.js';

export type DirectBridgeProvider = 'relay' | 'socket';
export type BridgeVerificationProvider = DirectBridgeProvider | 'layerswap';

/** Returns the decoded JSON body. Do not route this through Rabby's OpenAPI client. */
export type BridgeServiceRequest = (request: {
  url: string;
  method: 'GET' | 'POST';
  body?: unknown;
  timeoutMs: number;
  signal: AbortSignal;
}) => Promise<unknown>;

export type BridgeProviderVerification = {
  provider: BridgeVerificationProvider;
  /** LayerSwap associates calldata requestId with a directly fetched provider record. */
  binding: 'order-hash' | 'provider-transaction' | 'provider-record';
  parsed: ParsedBridgeCall;
};

export interface BridgeProviderClient {
  getQuotes(provider: DirectBridgeProvider, params: BridgeQuoteListParams): Promise<BridgeQuoteListItem[]>;
  buildTx(provider: DirectBridgeProvider, params: BridgeBuildTxParams): Promise<BridgeTx>;
  /** Recheck the final transaction after any wallet preparation and before signing. */
  verifyTx(provider: BridgeVerificationProvider, params: BridgeBuildTxParams, tx: BridgeTx): BridgeProviderVerification;
  /** Fetch the same LayerSwap order by recipient + calldata requestId before signing. */
  verifyLayerSwapTx(params: BridgeBuildTxParams, tx: BridgeTx): Promise<BridgeProviderVerification>;
  /** Detect clear() during asynchronous host/backend work outside the client. */
  captureContext(): () => void;
  /** Call on lock/account changes; also invalidates pending quote responses. */
  clear(): void;
}

export type BridgeProviderClientOptions = {
  request: BridgeServiceRequest;
  timeoutMs?: number;
  /** Dedicated access needs provider-issued client credentials in the host transport. */
  socketApi?: 'public' | 'dedicated';
};
