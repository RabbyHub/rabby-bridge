import type { BridgeErrorReporter } from './errors/index.js';
import { BRIDGE_ERRORS, BridgeError, asBridgeError, reportBridgeError } from './errors/index.js';
import type { OpenApiService } from '@rabby-wallet/rabby-api';
import {
  CALLDATA_AGGREGATORS,
  InvalidBridgeCalldataError,
  validateBridgeCalldata,
} from './calldata/index.js';
import type { BridgeCallExpectation } from './calldata/expect.js';
import type { BridgeCheck } from './calldata/types.js';
import { InvalidBridgeProviderError } from './providers/errors.js';
import type { BridgeProviderClient } from './providers/types.js';
import { SOCKET_PROVIDER_ROUTES } from './providers/socket.js';
import { BRIDGE_ENUM } from './consts.js';
import type { BridgeAggregatorId } from './consts.js';
import {
  getBridgeAltContracts,
  getBridgeRouter,
  getBridgeSpender,
  isSupportedBridgeAggregator,
  isSupportedBridgeChain,
} from './list.js';

export interface BridgeQuoteListParams {
  userAddress: string;
  fromChainId: string;
  fromTokenId: string;
  fromTokenRawAmount: string;
  toChainId: string;
  toTokenId: string;
  slippage?: string;
  feeRate?: number;
  /** Reuse the same client for quoting/building; transport connects directly to providers. */
  providerClient?: BridgeProviderClient;
  /** Receives failures filtered from quote lists; thrown errors are handled by the caller. */
  onError?: BridgeErrorReporter;
}

export interface BridgeBuildTxParams extends BridgeQuoteListParams {
  bridgeId: string;
  quoteKey?: string | Record<string, unknown>;
  /** Quoted output in raw units, before applying slippage. */
  toTokenRawAmount?: string;
}

export type BridgeApi = Pick<
  OpenApiService,
  | 'getBridgeQuoteListV2'
  | 'getBridgeQuoteV2'
  | 'buildBridgeTx'
  | 'getBridgeQuoteTxV2'
>;

export type BridgeQuote = Awaited<ReturnType<BridgeApi['getBridgeQuoteTxV2']>>;

export type BridgeTx =
  | Awaited<ReturnType<BridgeApi['buildBridgeTx']>>
  | NonNullable<BridgeQuote['tx']>;

export type BridgeQuoteListItem = Awaited<
  ReturnType<BridgeApi['getBridgeQuoteV2']>
>[number];

export class InvalidBridgeContractError extends BridgeError {
  constructor(
    public readonly kind: 'spender' | 'router',
    public readonly aggregatorId: BridgeAggregatorId,
    public readonly chainId: string,
    public readonly expected: string,
    public readonly received: string,
    public readonly bridgeId?: string
  ) {
    super(kind === 'router' ? BRIDGE_ERRORS.ROUTER_NOT_ALLOWED : BRIDGE_ERRORS.SPENDER_NOT_ALLOWED,
      { aggregatorId, chainId, bridgeId });
    this.message =
      `Invalid bridge ${kind} for ${aggregatorId} on ${chainId}: expected ${expected}, got ${received}`;
    this.name = 'InvalidBridgeContractError';
  }
}

const isSameAddress = (left?: string, right?: string) => {
  if (!left || !right) {
    return false;
  }
  return left.toLowerCase() === right.toLowerCase();
};

function assertSupported(
  aggregatorId: string,
  fromChainId: string
): asserts aggregatorId is BridgeAggregatorId {
  if (!isSupportedBridgeAggregator(aggregatorId)) {
    const error = new BridgeError(BRIDGE_ERRORS.UNSUPPORTED_BRIDGE_AGGREGATOR, { aggregatorId, chainId: fromChainId });
    error.message = `${aggregatorId} is not supported`;
    throw error;
  }
  if (!isSupportedBridgeChain(aggregatorId, fromChainId)) {
    const error = new BridgeError(BRIDGE_ERRORS.UNSUPPORTED_SOURCE_CHAIN, { aggregatorId, chainId: fromChainId });
    error.message = `${aggregatorId} does not support ${fromChainId}`;
    throw error;
  }
}

const requireSlippage = (slippage?: string) => {
  if (!slippage) {
    throw new BridgeError(BRIDGE_ERRORS.SLIPPAGE_IS_REQUIRED_FOR_THIS_API_CALL);
  }
  return slippage;
};

const stringifyQuoteKey = (quoteKey?: string | Record<string, unknown>) => {
  if (typeof quoteKey === 'string') {
    return quoteKey;
  }
  return JSON.stringify(quoteKey || {});
};

const shouldValidateBridgeContracts = (aggregatorId: BridgeAggregatorId) =>
  aggregatorId !== BRIDGE_ENUM.NEAR_INTENTS;

export const validateBridgeQuote = (
  aggregatorId: BridgeAggregatorId,
  fromChainId: string,
  quote: BridgeQuoteListItem
) => {
  if (!shouldValidateBridgeContracts(aggregatorId)) {
    return true;
  }

  const expectedSpender = getBridgeSpender(aggregatorId, fromChainId);
  const receivedSpender = quote.approve_contract_id;

  if (!receivedSpender) {
    return true;
  }
  if (!expectedSpender) {
    throw new InvalidBridgeContractError('spender', aggregatorId, fromChainId,
      'configured spender', receivedSpender, quote.bridge_id);
  }

  const allowedSpenders = [
    expectedSpender,
    ...getBridgeAltContracts(aggregatorId),
  ];

  if (!allowedSpenders.some((addr) => isSameAddress(addr, receivedSpender))) {
    throw new InvalidBridgeContractError(
      'spender',
      aggregatorId,
      fromChainId,
      expectedSpender,
      receivedSpender,
      quote.bridge_id
    );
  }

  return true;
};

const quotedToAmount = (quoteKey?: string | Record<string, unknown>) => {
  let key = quoteKey;
  if (typeof key === 'string') {
    try { key = JSON.parse(key); }
    catch { return undefined; }
  }
  if (!key || typeof key !== 'object' || Array.isArray(key)) return undefined;
  const amount = key.to_token_raw_amount;
  if (typeof amount === 'string' || (typeof amount === 'number' && Number.isSafeInteger(amount))) {
    return String(amount);
  }
  return undefined;
};

const checkBridgeTx = (
  aggregatorId: BridgeAggregatorId,
  fromChainId: string,
  bridgeId: string,
  tx: BridgeTx,
  expectation?: BridgeCallExpectation
): BridgeCheck | undefined => {
  if (!shouldValidateBridgeContracts(aggregatorId)) {
    return undefined;
  }

  const expectedRouter = getBridgeRouter(aggregatorId, fromChainId);

  const allowedRouters = [
    ...(expectedRouter ? [expectedRouter] : []),
    ...getBridgeAltContracts(aggregatorId),
  ];

  if (!allowedRouters.some((addr) => isSameAddress(addr, tx.to))) {
    throw new InvalidBridgeContractError(
      'router',
      aggregatorId,
      fromChainId,
      expectedRouter || allowedRouters.join(',') || 'configured router',
      tx.to,
      bridgeId
    );
  }

  if (CALLDATA_AGGREGATORS.includes(aggregatorId)) {
    const check = validateBridgeCalldata(aggregatorId, fromChainId, tx, expectation);
    if (!check.ok) {
      throw new InvalidBridgeCalldataError(
        aggregatorId,
        fromChainId,
        check.method,
        check.reason || BRIDGE_ERRORS.INVALID_CALLDATA.message,
        check.errors.map((error) => ({ ...error, bridgeId }))
      );
    }
    return check;
  }
  return undefined;
};

export const validateBridgeTx = (
  aggregatorId: BridgeAggregatorId,
  fromChainId: string,
  bridgeId: string,
  tx: BridgeTx,
  expectation?: BridgeCallExpectation
) => {
  checkBridgeTx(aggregatorId, fromChainId, bridgeId, tx, expectation);
  return true;
};

export const getQuote = async (
  aggregatorId: string,
  params: BridgeQuoteListParams,
  api: BridgeApi
): Promise<BridgeQuoteListItem[]> => {
  try {
    assertSupported(aggregatorId, params.fromChainId);
    const assertContext = params.providerClient?.captureContext();

    if (aggregatorId === BRIDGE_ENUM.RELAY) {
      if (!params.providerClient) throw new InvalidBridgeProviderError('relay', BRIDGE_ERRORS.DIRECT_PROVIDER_CLIENT_IS_REQUIRED);
      const quotes = await params.providerClient.getQuotes('relay', params);
      assertContext?.();
      return quotes;
    }

    const baseParams = {
      aggregator_id: aggregatorId,
      user_addr: params.userAddress,
      from_chain_id: params.fromChainId,
      from_token_id: params.fromTokenId,
      from_token_raw_amount: params.fromTokenRawAmount,
      to_chain_id: params.toChainId,
      to_token_id: params.toTokenId,
      fee_rate: params.feeRate,
      slippage: requireSlippage(params.slippage),
    };

    const [backendQuotes, providerQuotes] = await Promise.all([
      api.getBridgeQuoteListV2
        ? api.getBridgeQuoteListV2(baseParams).catch((error) => { throw asBridgeError(error, BRIDGE_ERRORS.BACKEND_QUOTE_REQUEST_FAILED); })
        : api.getBridgeQuoteV2?.(baseParams).catch((error) => { throw asBridgeError(error, BRIDGE_ERRORS.BACKEND_QUOTE_REQUEST_FAILED); }),
      aggregatorId === BRIDGE_ENUM.SOCKET && params.providerClient
        ? params.providerClient.getQuotes('socket', params).catch((error) => {
            if (error instanceof InvalidBridgeProviderError) {
              reportBridgeError(params.onError, error, { aggregatorId, chainId: params.fromChainId, operation: 'getQuote' });
              return [];
            }
            throw error;
          })
        : Promise.resolve([]),
    ]);
    assertContext?.();

    if (!backendQuotes) {
      throw new BridgeError(BRIDGE_ERRORS.MISSING_QUOTE_API);
    }
    const quotes = [
      ...backendQuotes.filter((quote) => !(aggregatorId === BRIDGE_ENUM.SOCKET && params.providerClient &&
        SOCKET_PROVIDER_ROUTES.includes(quote.bridge_id))),
      ...providerQuotes,
    ];

    return quotes.filter((quote) => {
      try {
        validateBridgeQuote(aggregatorId, params.fromChainId, quote);
        return true;
      } catch (error) {
        if (error instanceof InvalidBridgeContractError) {
          reportBridgeError(params.onError, error, { aggregatorId, chainId: params.fromChainId, bridgeId: quote.bridge_id, operation: 'getQuote' });
          return false;
        }
        throw error;
      }
    });
  } catch (error) {
    throw asBridgeError(error, BRIDGE_ERRORS.UNKNOWN, { aggregatorId, chainId: params.fromChainId, operation: 'getQuote' });
  }
};

export const buildTx = async (
  aggregatorId: string,
  params: BridgeBuildTxParams,
  api: BridgeApi
): Promise<BridgeTx> => {
  try {
    // Freeze signing intent before awaiting a backend response.
    params = { ...params };
    assertSupported(aggregatorId, params.fromChainId);
    const assertContext = params.providerClient?.captureContext();

    if (aggregatorId === BRIDGE_ENUM.RELAY ||
        (aggregatorId === BRIDGE_ENUM.SOCKET && SOCKET_PROVIDER_ROUTES.includes(params.bridgeId))) {
      if (!params.providerClient) throw new InvalidBridgeProviderError(aggregatorId, BRIDGE_ERRORS.DIRECT_PROVIDER_CLIENT_IS_REQUIRED);
      const tx = await params.providerClient.buildTx(aggregatorId as 'relay' | 'socket', params);
      assertContext?.();
      return tx;
    }

    const buildParams = {
      aggregator_id: aggregatorId,
      bridge_id: params.bridgeId,
      user_addr: params.userAddress,
      from_chain_id: params.fromChainId,
      from_token_id: params.fromTokenId,
      from_token_raw_amount: params.fromTokenRawAmount,
      to_chain_id: params.toChainId,
      to_token_id: params.toTokenId,
      slippage: requireSlippage(params.slippage),
    };

    const tx = api.buildBridgeTx
      ? await api.buildBridgeTx({
          ...buildParams,
          quote_key: stringifyQuoteKey(params.quoteKey),
        }).catch((error) => { throw asBridgeError(error, BRIDGE_ERRORS.BACKEND_BUILD_REQUEST_FAILED); })
      : (
          await api.getBridgeQuoteTxV2?.({
            ...buildParams,
          }).catch((error) => { throw asBridgeError(error, BRIDGE_ERRORS.BACKEND_BUILD_REQUEST_FAILED); })
        )?.tx;

    if (!tx) {
      throw new BridgeError(BRIDGE_ERRORS.MISSING_BUILD_API);
    }
    assertContext?.();

    const expectation: BridgeCallExpectation = {
      userAddress: params.userAddress,
      fromTokenId: params.fromTokenId,
      fromTokenRawAmount: params.fromTokenRawAmount,
      toChainId: params.toChainId,
      toTokenId: params.toTokenId,
      toTokenRawAmount: params.toTokenRawAmount ?? quotedToAmount(params.quoteKey),
      slippage: params.slippage,
    };
    const check = checkBridgeTx(aggregatorId, params.fromChainId, params.bridgeId, tx, expectation);

    // A backend may mislabel bridge_id. Decide from calldata as well, so renaming
    // an RFQ/CCTP/LayerSwap route cannot bypass the provider requirement.
    const parsed = check?.parsed;
    if (aggregatorId === BRIDGE_ENUM.LIFI && parsed?.method.endsWith('ViaLayerSwap')) {
      if (!params.providerClient) throw new InvalidBridgeProviderError('layerswap', BRIDGE_ERRORS.DIRECT_PROVIDER_CLIENT_IS_REQUIRED);
      await params.providerClient.verifyLayerSwapTx({
        ...params, toTokenRawAmount: expectation.toTokenRawAmount,
      }, tx);
      assertContext?.();
      return tx;
    }
    if (aggregatorId === BRIDGE_ENUM.SOCKET && parsed?.unresolvedFields?.length &&
        ['receiveERC20', 'depositForBurn'].includes(parsed.protocolMethod ?? '')) {
      throw new InvalidBridgeProviderError(aggregatorId, BRIDGE_ERRORS.PROVIDER_DESTINATION_UNBOUND);
    }
    // shortcut: chain-state output checks are deferred until the follow-up RPC PR.
    const unverifiedFields = check?.unverifiedFields?.filter((field) =>
      !(field === 'outputToken' && parsed?.outputToken === undefined && parsed?.outputTokenReference) &&
      !(field === 'minOutputAmount' && parsed?.minOutputAmount === undefined && parsed?.outputAmountReference));
    if (unverifiedFields?.length) {
      throw new InvalidBridgeCalldataError(aggregatorId, params.fromChainId, check?.method,
        `unverified bridge fields: ${unverifiedFields.join(',')}`,
        [{ ...BRIDGE_ERRORS.UNVERIFIED_BRIDGE_FIELDS, bridgeId: params.bridgeId, unverifiedFields }]);
    }

    return tx;
  } catch (error) {
    throw asBridgeError(error, BRIDGE_ERRORS.UNKNOWN, { aggregatorId, chainId: params.fromChainId, operation: 'buildTx', bridgeId: params.bridgeId });
  }
};

export const getQuoteListWithTx = async (
  aggregatorId: string,
  params: BridgeQuoteListParams,
  api: BridgeApi
): Promise<Array<BridgeQuoteListItem & { tx: BridgeTx }>> => {
  const quotes = await getQuote(aggregatorId, params, api);

  const settled: Array<(BridgeQuoteListItem & { tx: BridgeTx }) | null> =
    await Promise.all(
      quotes.map(async (quote) => {
      try {
        const tx = await buildTx(
          aggregatorId,
          {
            ...params,
            bridgeId: quote.bridge_id,
            quoteKey: quote.quote_key,
            toTokenRawAmount: quote.to_token_raw_amount_hex_str ??
              (Number.isSafeInteger(quote.to_token_raw_amount) ? String(quote.to_token_raw_amount) : undefined),
          },
          api
        );

        return {
          ...quote,
          tx,
        };
      } catch (error) {
        if (
          error instanceof InvalidBridgeContractError ||
          error instanceof InvalidBridgeCalldataError ||
          error instanceof InvalidBridgeProviderError
        ) {
          reportBridgeError(params.onError, error, { aggregatorId, chainId: params.fromChainId, bridgeId: quote.bridge_id, operation: 'buildTx' });
          return null;
        }
        throw error;
      }
      })
    );

  return settled.filter(
    (quote): quote is BridgeQuoteListItem & { tx: BridgeTx } =>
      quote !== null
  );
};

export const getQuoteList = getQuote;

export const buildBridgeQuoteTx = buildTx;
