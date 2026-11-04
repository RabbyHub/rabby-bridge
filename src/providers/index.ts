import { BRIDGE_ERRORS, BridgeError, asBridgeError } from '../errors/index.js';
import { validateBridgeQuote, validateBridgeTx } from '../quote.js';
import type { BridgeBuildTxParams, BridgeQuoteListItem, BridgeQuoteListParams, BridgeTx } from '../quote.js';
import { address, array, assertIntent, bytes, chain, feeDisplay, intentKey, object, sameTransaction, slippageBps, tokenAddress, uint } from './data.js';
import { InvalidBridgeProviderError } from './errors.js';
import { layerSwapOrderRows, layerSwapSequence, readLayerSwapDeposit, readLayerSwapOrder } from './layerswap.js';
import { readRelayQuote, relayChains } from './relay.js';
import type { ProviderQuoteData, RelayChain } from './relay.js';
import { requestProvider } from './request.js';
import { readSocketQuote, SOCKET_PROVIDER_ROUTES, socketBridgeId } from './socket.js';
import type { BridgeErrorContext } from '../errors/index.js';
import type { BridgeProviderClient, BridgeProviderClientOptions, BridgeVerificationProvider, DirectBridgeProvider } from './types.js';

const FEE_RECIPIENT = '0x9899f62ecf16b70bffc88677023026c47e48c218';
const MAX_CACHE_ENTRIES = 100;
const EXCLUDED_SOCKET_PROVIDERS = [
  'symbiosis', 'symbiosis-btc-citrea', 'synapse', 'celer', 'stargate', 'stargate-v2',
  'arbitrum-bridge', 'mayan', 'across', 'relay', 'near-intents', 'squid',
];

const feeBps = (params: BridgeQuoteListParams): number => {
  const percent = params.feeRate ?? 0.25;
  const bps = percent * 100;
  if (!Number.isFinite(bps) || bps < 0 || bps > 300 || Math.abs(bps - Math.round(bps)) > 1e-8) throw new BridgeError(BRIDGE_ERRORS.UNSUPPORTED_FEE_RATE);
  return Math.round(bps);
};

export const isDirectBridgeProviderRoute = (provider: string, bridgeId: string): provider is DirectBridgeProvider =>
  provider === 'relay' || (provider === 'socket' && SOCKET_PROVIDER_ROUTES.includes(bridgeId));

type Entry = {
  provider: BridgeVerificationProvider;
  bridgeId: string;
  intent: string;
  data: ProviderQuoteData;
};

const quoteMetadata = (provider: DirectBridgeProvider, bridgeId: string) => {
  const name = provider === 'relay' ? 'Relay' : 'Socket';
  const logo = provider === 'relay'
    ? 'https://static.debank.com/image/bridge/logo_url/4acc023e14cf2d02da4c365d3940b15d/4acc023e14cf2d02da4c365d3940b15d.png'
    : 'https://media.socket.tech/bridges/socket-icon.png';
  return { aggregator: { id: provider, name, logo_url: logo, bridge_list: [] },
    bridge: { id: bridgeId, name: ({ relay: 'Relay', 'rfq-vault-executor': 'Socket Intents',
      'cctp-v2': 'CCTP V2', 'cctp-v2-slow': 'CCTP V2 Slow' } as Record<string, string>)[bridgeId] ?? bridgeId,
      logo_url: logo }, bridge_id: bridgeId };
};

// Convert service USD display fees to output-token raw units. These estimates
// never participate in transaction/order comparisons.
const displayOutputFee = (usdValue: unknown, output: Record<string, unknown>, expectedAmount: bigint) => {
  const usd = Number(usdValue ?? 0);
  const outputUsd = Number(output.amountUsd ?? output.valueInUsd ?? 0);
  if (!Number.isFinite(usd) || usd < 0 || !Number.isFinite(outputUsd) || outputUsd < 0) throw new BridgeError(BRIDGE_ERRORS.INVALID_FEE_DISPLAY);
  const feeUnits = Math.round(usd * 1e8), outputUnits = Math.round(outputUsd * 1e8);
  const raw = Number.isSafeInteger(feeUnits) && Number.isSafeInteger(outputUnits) && outputUnits > 0
    ? expectedAmount * BigInt(feeUnits) / BigInt(outputUnits) : 0n;
  return feeDisplay(raw, usd);
};

// Quote/UI number fields are legacy API compatibility only. Comparisons and the
// quote cache always use bigint/raw hex, never these floating-point values.
const makeQuote = (provider: DirectBridgeProvider, bridgeId: string, data: ProviderQuoteData, decimals: number): BridgeQuoteListItem => ({
  ...quoteMetadata(provider, bridgeId),
  to_token_amount: Number(data.expectedAmount) / 10 ** decimals,
  to_token_raw_amount: Number(data.expectedAmount),
  to_token_raw_amount_hex_str: `0x${data.expectedAmount.toString(16)}`,
  approve_contract_id: data.approveAddress,
  quote_key: { provider, order_id: data.orderId, request_id: data.requestId,
    to_token_raw_amount: data.expectedAmount.toString() },
  gas_fee: feeDisplay('0'), protocol_fee: feeDisplay('0'), rabby_fee: feeDisplay('0'),
  duration: 0, routePath: '',
});

export const createBridgeProviderClient = (options: BridgeProviderClientOptions): BridgeProviderClient => {
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new BridgeError(BRIDGE_ERRORS.INVALID_PROVIDER_TIMEOUT);
  const request = options.request;
  const socketApi = options.socketApi ?? 'public';
  if (socketApi !== 'public' && socketApi !== 'dedicated') throw new BridgeError(BRIDGE_ERRORS.INVALID_SOCKET_API);
  const entries = new Map<string, Entry>();
  let generation = 0;
  let chains: RelayChain[] | undefined;
  let chainsRequest: Promise<RelayChain[]> | undefined;
  const readChains = async (): Promise<RelayChain[]> => {
    if (chains) return chains;
    if (!chainsRequest) {
      chainsRequest = requestProvider(request, timeoutMs, 'relay', '/chains')
        .then(relayChains).then((value) => (chains = value))
        .finally(() => { chainsRequest = undefined; });
    }
    return chainsRequest;
  };
  const guard = async <T>(provider: BridgeVerificationProvider, work: () => T | Promise<T>, context: BridgeErrorContext): Promise<T> => {
    try { return await work(); }
    catch (error) {
      const failure = asBridgeError(error, BRIDGE_ERRORS.INVALID_RESPONSE, { ...context, provider });
      if (failure instanceof InvalidBridgeProviderError) throw failure;
      throw new InvalidBridgeProviderError(provider, failure);
    }
  };
  const cacheKey = (provider: BridgeVerificationProvider, fromChainId: string, orderId: string) =>
    `${provider}:${provider === 'layerswap' ? `${chain(fromChainId)}:` : ''}${orderId}`;
  const save = (provider: BridgeVerificationProvider, params: BridgeQuoteListParams, data: ProviderQuoteData, bridgeId: string, startedGeneration: number) => {
    if (startedGeneration !== generation) throw new BridgeError(BRIDGE_ERRORS.QUOTE_REQUEST_WAS_INVALIDATED);
    assertIntent(data.parsed, params, data.expectedAmount, data.minimumQuantum);
    validateBridgeTx(provider === 'layerswap' ? 'lifi' : provider, params.fromChainId, bridgeId, data.tx, {
      userAddress: params.userAddress, fromTokenId: params.fromTokenId, fromTokenRawAmount: params.fromTokenRawAmount,
      toChainId: params.toChainId, toTokenId: params.toTokenId,
    });
    if (entries.size >= MAX_CACHE_ENTRIES) entries.delete(entries.keys().next().value as string);
    entries.set(cacheKey(provider, params.fromChainId, data.orderId), { provider, bridgeId, intent: intentKey(params), data });
  };
  const store = (provider: DirectBridgeProvider, params: BridgeQuoteListParams, data: ProviderQuoteData, quote: BridgeQuoteListItem, startedGeneration: number) => {
    validateBridgeQuote(provider, params.fromChainId, quote);
    save(provider, params, data, quote.bridge_id, startedGeneration);
    // No proof/transaction references escape the client cache.
    return { ...quote, quote_key: { ...quote.quote_key }, gas_fee: { ...quote.gas_fee },
      protocol_fee: { ...quote.protocol_fee }, rabby_fee: { ...quote.rabby_fee } };
  };
  const layerSwapExpected = (params: BridgeBuildTxParams): bigint => {
    if (params.toTokenRawAmount !== undefined) return uint(params.toTokenRawAmount);
    let key: unknown = params.quoteKey;
    if (typeof key === 'string') {
      try { key = JSON.parse(key); }
      catch { throw new BridgeError(BRIDGE_ERRORS.INVALID_QUOTE_KEY); }
    }
    return uint(object(key).to_token_raw_amount);
  };
  const entryFor = (provider: BridgeVerificationProvider, params: BridgeBuildTxParams, tx?: BridgeTx): Entry => {
    let orderId: string;
    let requestId: unknown;
    let quotedAmount: unknown = params.toTokenRawAmount;
    if (provider === 'layerswap') {
      if (!tx) throw new BridgeError(BRIDGE_ERRORS.LAYERSWAP_TRANSACTION_IS_REQUIRED);
      orderId = bytes(readLayerSwapDeposit(tx, params).parsed.orderId, 32);
      requestId = orderId;
    } else {
      let key: unknown = params.quoteKey;
      if (typeof key === 'string') {
        try { key = JSON.parse(key); }
        catch { throw new BridgeError(BRIDGE_ERRORS.INVALID_QUOTE_KEY); }
      }
      const quoteKey = object(key);
      if (quoteKey.provider !== provider) throw new BridgeError(BRIDGE_ERRORS.A_DIRECT_PROVIDER_QUOTE_IS_REQUIRED);
      orderId = bytes(quoteKey.order_id, 32);
      requestId = quoteKey.request_id;
      quotedAmount ??= quoteKey.to_token_raw_amount;
    }
    const key = cacheKey(provider, params.fromChainId, orderId);
    const entry = entries.get(key);
    if (!entry || entry.intent !== intentKey(params) || entry.bridgeId !== params.bridgeId || entry.data.requestId !== requestId) throw new BridgeError(BRIDGE_ERRORS.QUOTE_DOES_NOT_MATCH_LOCAL_INTENT);
    const expected = provider === 'layerswap' ? layerSwapExpected(params) : uint(quotedAmount);
    if (expected !== entry.data.expectedAmount) throw new BridgeError(BRIDGE_ERRORS.QUOTED_AMOUNT_CHANGED);
    return entry;
  };
  const client: BridgeProviderClient = {
    async getQuotes(provider, originalParams) {
      // Capture user intent before the first await. Host state may change while requesting.
      const params = { ...originalParams };
      const startedGeneration = generation;
      return guard(provider, async () => {
        if (provider !== 'relay' && provider !== 'socket') throw new BridgeError(BRIDGE_ERRORS.UNSUPPORTED_DIRECT_PROVIDER);
        intentKey(params);
        const bps = slippageBps(params.slippage), appFeeBps = feeBps(params);
        if (provider === 'relay') {
          const metadata = await readChains();
          if (startedGeneration !== generation) throw new BridgeError(BRIDGE_ERRORS.QUOTE_REQUEST_WAS_INVALIDATED);
          const raw = await requestProvider(request, timeoutMs, provider, '/quote/v2', {
            user: address(params.userAddress), recipient: address(params.userAddress),
            originChainId: Number(chain(params.fromChainId)), destinationChainId: Number(chain(params.toChainId)),
            originCurrency: tokenAddress(params.fromTokenId, params.fromChainId), destinationCurrency: tokenAddress(params.toTokenId, params.toChainId),
            amount: uint(params.fromTokenRawAmount).toString(), tradeType: 'EXACT_INPUT', slippageTolerance: String(bps),
            includeProtocolData: true, useExternalLiquidity: false,
            ...(appFeeBps ? { appFees: [{ recipient: FEE_RECIPIENT, fee: String(appFeeBps) }] } : {}),
          });
          const data = readRelayQuote(raw, params, metadata);
          const details = object(object(raw).details), output = object(details.currencyOut);
          if (uint(output.amount) !== data.expectedAmount || uint(output.minimumAmount) !== data.parsed.minOutputAmount) throw new BridgeError(BRIDGE_ERRORS.RELAY_DISPLAY_AMOUNT_MISMATCH);
          const quote = makeQuote(provider, 'relay', data, Number(uint(object(output.currency).decimals, 8)));
          quote.duration = Number(uint(details.timeEstimate ?? 60, 32));
          const fees = object(object(raw).fees ?? {});
          const gas = object(fees.gas ?? {}), relayer = object(fees.relayerService ?? {}), app = object(fees.app ?? {});
          quote.gas_fee = feeDisplay(gas.amount, gas.amountUsd);
          quote.protocol_fee = displayOutputFee(relayer.amountUsd, output, data.expectedAmount);
          quote.rabby_fee = displayOutputFee(app.amountUsd, output, data.expectedAmount);
          return [store(provider, params, data, quote, startedGeneration)];
        }
        if (socketApi === 'public' && appFeeBps !== 0) throw new BridgeError(BRIDGE_ERRORS.SOCKET_PUBLIC_APP_FEE_UNSUPPORTED);
        const query: Record<string, string> = {
          userOps: 'tx', userAddress: address(params.userAddress), receiverAddress: address(params.userAddress),
          originChainId: chain(params.fromChainId).toString(), destinationChainId: chain(params.toChainId).toString(),
          inputToken: tokenAddress(params.fromTokenId, params.fromChainId), outputToken: tokenAddress(params.toTokenId, params.toChainId),
          inputAmount: uint(params.fromTokenRawAmount).toString(), slippage: String(bps / 100),
          excludeProvider: EXCLUDED_SOCKET_PROVIDERS.join(','), simulatedQuotesRequired: 'true',
          ...(appFeeBps ? { feeBps: String(appFeeBps), feeTakerAddress: FEE_RECIPIENT } : {}),
        };
        const raw = object(await requestProvider(request, timeoutMs, provider, '/v3/swap/quote?' +
          Object.entries(query).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&'), undefined, socketApi));
        if (raw.success !== true) throw new BridgeError(BRIDGE_ERRORS.SOCKET_QUOTE_REQUEST_REJECTED);
        const result = object(raw.result);
        const quotes: BridgeQuoteListItem[] = [];
        for (const routeValue of array(result.routes)) {
          const route = object(routeValue), details = object(route.routeDetails);
          if (!details.bridgeDetails) continue;
          const bridgeId = socketBridgeId(object(object(details.bridgeDetails).protocol).name);
          if (!SOCKET_PROVIDER_ROUTES.includes(bridgeId)) continue;
          try {
            const data = readSocketQuote(result, route, params);
            const quote = makeQuote(provider, bridgeId, data, Number(uint(object(object(route.output).token).decimals, 8)));
            quote.duration = Number(uint(route.estimatedTime ?? 360, 32));
            const gas = object(route.gasFee ?? {}), fee = object(details.feeDetails ?? {});
            quote.gas_fee = feeDisplay(gas.estimatedFee, gas.feeInUsd);
            const input = object(result.input), inputToken = object(input.token);
            const output = object(route.output), outputToken = object(output.token);
            const feeToken = fee.feeToken ? object(fee.feeToken) : undefined;
            let feeUsd = 0;
            if (feeToken) {
              const priced = uint(feeToken.chainId) === uint(inputToken.chainId) && address(feeToken.address) === address(inputToken.address) ? input
                : uint(feeToken.chainId) === uint(outputToken.chainId) && address(feeToken.address) === address(outputToken.address) ? output : undefined;
              if (priced) feeUsd = Number(uint(fee.feeAmount ?? '0')) / 10 ** Number(uint(feeToken.decimals, 8)) * Number(priced.priceInUsd ?? 0);
            }
            const feeDisplayValue = displayOutputFee(feeUsd, output, data.expectedAmount);
            if (fee.feeTakerAddress && address(fee.feeTakerAddress) === FEE_RECIPIENT) quote.rabby_fee = feeDisplayValue;
            else quote.protocol_fee = feeDisplayValue;
            quotes.push(store(provider, params, data, quote, startedGeneration));
          } catch (error) {
            throw asBridgeError(error, BRIDGE_ERRORS.INVALID_RESPONSE, { bridgeId });
          }
        }
        return quotes;
      }, { aggregatorId: provider, chainId: params.fromChainId, toChainId: params.toChainId, ...(provider === 'relay' ? { bridgeId: 'relay' } : {}), operation: 'getQuote' });
    },
    async buildTx(provider, originalParams) {
      const params = { ...originalParams };
      return guard(provider, () => {
        const entry = entryFor(provider, params);
        const tx = { ...entry.data.tx };
        client.verifyTx(provider, params, tx);
        return tx;
      }, { aggregatorId: provider, chainId: params.fromChainId, toChainId: params.toChainId, bridgeId: params.bridgeId, operation: 'buildTx' });
    },
    async verifyLayerSwapTx(originalParams, tx) {
      const params = { ...originalParams };
      const startedGeneration = generation;
      return guard('layerswap', async () => {
        params.toTokenRawAmount = layerSwapExpected(params).toString();
        const deposit = readLayerSwapDeposit(tx, params);
        validateBridgeTx('lifi', params.fromChainId, params.bridgeId, deposit.tx, {
          userAddress: params.userAddress, fromTokenId: params.fromTokenId, fromTokenRawAmount: params.fromTokenRawAmount,
          toChainId: params.toChainId, toTokenId: params.toTokenId,
        });
        const key = cacheKey('layerswap', params.fromChainId, bytes(deposit.parsed.orderId, 32));
        const cached = entries.get(key);
        if (cached) return client.verifyTx('layerswap', params, deposit.tx);
        const end = Date.now() + timeoutMs;
        const seenPages = new Set<string>();
        for (let page = 1; page <= 10; page++) {
          if (startedGeneration !== generation) throw new BridgeError(BRIDGE_ERRORS.QUOTE_REQUEST_WAS_INVALIDATED);
          const remaining = end - Date.now();
          if (remaining <= 0) throw new BridgeError(BRIDGE_ERRORS.LAYERSWAP_LOOKUP_TIMED_OUT);
          const raw = await requestProvider(request, remaining, 'layerswap',
            `/api/v2/explorer/${address(deposit.parsed.receiver)}?page=${page}`);
          const rows = layerSwapOrderRows(raw);
          const matches = rows.filter((row) => {
            try { return layerSwapSequence(row) === uint(deposit.parsed.orderId); }
            catch { return false; }
          });
          if (matches.length > 1) throw new BridgeError(BRIDGE_ERRORS.AMBIGUOUS_LAYERSWAP_REQUEST_ID);
          if (matches.length === 1) {
            const data = readLayerSwapOrder(matches[0], params, deposit);
            if (data.expectedAmount !== uint(params.toTokenRawAmount)) throw new BridgeError(BRIDGE_ERRORS.LAYERSWAP_QUOTED_AMOUNT_CHANGED);
            save('layerswap', params, data, 'layerswap', startedGeneration);
            return client.verifyTx('layerswap', params, deposit.tx);
          }
          if (!rows.length) break;
          const fingerprint = JSON.stringify(rows.map((row) => object(object(row).swap).id));
          if (seenPages.has(fingerprint)) throw new BridgeError(BRIDGE_ERRORS.LAYERSWAP_PAGINATION_DID_NOT_ADVANCE);
          seenPages.add(fingerprint);
        }
        throw new BridgeError(BRIDGE_ERRORS.LAYERSWAP_ORDER_NOT_FOUND);
      }, { aggregatorId: 'lifi', chainId: params.fromChainId, toChainId: params.toChainId, bridgeId: params.bridgeId, operation: 'verifyLayerSwapTx' });
    },
    verifyTx(provider, params, tx) {
      try {
        const entry = entryFor(provider, params, tx);
        if (!sameTransaction(tx, entry.data.tx)) throw new BridgeError(BRIDGE_ERRORS.SOURCE_TRANSACTION_CHANGED);
        assertIntent(entry.data.parsed, params, entry.data.expectedAmount, entry.data.minimumQuantum);
        validateBridgeTx(provider === 'layerswap' ? 'lifi' : provider, params.fromChainId, params.bridgeId, tx);
        return { provider, binding: provider === 'relay' ? 'order-hash' : provider === 'layerswap' ? 'provider-record' : 'provider-transaction',
          parsed: { ...entry.data.parsed, unresolvedFields: [] } };
      } catch (error) {
        const failure = asBridgeError(error, BRIDGE_ERRORS.INVALID_TRANSACTION, { provider,
          aggregatorId: provider === 'layerswap' ? 'lifi' : provider, chainId: params.fromChainId, toChainId: params.toChainId,
          bridgeId: params.bridgeId, operation: 'verifyTx' });
        if (failure instanceof InvalidBridgeProviderError) throw failure;
        throw new InvalidBridgeProviderError(provider, failure);
      }
    },
    captureContext() {
      const expected = generation;
      return () => {
        if (generation !== expected) throw new InvalidBridgeProviderError('context', BRIDGE_ERRORS.PROVIDER_CLIENT_CONTEXT_CHANGED);
      };
    },
    clear() { generation++; entries.clear(); },
  };
  return client;
};

export { InvalidBridgeProviderError } from './errors.js';
export { BRIDGE_PROVIDER_ORIGINS, createBridgeFetchRequest } from './request.js';
export type { BridgeFetch } from './request.js';
export type { BridgeProviderClient, BridgeProviderClientOptions, BridgeProviderVerification, BridgeVerificationProvider, BridgeServiceRequest, DirectBridgeProvider } from './types.js';
