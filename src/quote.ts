import type { BridgeErrorContext, BridgeErrorReporter } from './errors/index.js';
import { BRIDGE_ERRORS, BridgeError, asBridgeError, reportBridgeError } from './errors/index.js';
import type { OpenApiService } from '@rabby-wallet/rabby-api';
import {
  CALLDATA_AGGREGATORS,
  InvalidBridgeCalldataError,
  validateBridgeCalldata,
} from './calldata/index.js';
import type { BridgeCallExpectation } from './calldata/expect.js';
import type { BridgeCheck } from './calldata/types.js';
import { calldataDiagnostics } from './calldata/diagnostics.js';
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

export interface BridgeValidationOptions {
  /** Observe new validation failures while preserving main's business decisions. Defaults to false. */
  lite?: boolean;
  /** Receives filtered failures and non-blocking lite validation failures. */
  onError?: BridgeErrorReporter;
}

export interface BridgeQuoteListParams extends BridgeValidationOptions {
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

const handleNewValidationError = (error: unknown, options: BridgeValidationOptions, context: BridgeErrorContext) => {
  if (!options.lite) throw error;
  reportBridgeError(options.onError, asBridgeError(error), { ...context, lite: true, blocking: false });
};

export const validateBridgeQuote = (
  aggregatorId: BridgeAggregatorId,
  fromChainId: string,
  quote: BridgeQuoteListItem,
  options: BridgeValidationOptions = {}
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
    handleNewValidationError(new InvalidBridgeContractError('spender', aggregatorId, fromChainId,
      'configured spender', receivedSpender, quote.bridge_id), options,
      { aggregatorId, chainId: fromChainId, bridgeId: quote.bridge_id, operation: 'getQuote' });
    return true;
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

const validateBridgeRouter = (
  aggregatorId: BridgeAggregatorId,
  fromChainId: string,
  bridgeId: string,
  tx: BridgeTx,
  legacy = false
): void => {
  if (!shouldValidateBridgeContracts(aggregatorId)) {
    return undefined;
  }

  const expectedRouter = getBridgeRouter(aggregatorId, fromChainId);
  if (legacy && !expectedRouter) return;

  const allowedRouters = [
    ...(expectedRouter ? [expectedRouter] : []),
    ...getBridgeAltContracts(aggregatorId),
  ];

  if (!allowedRouters.some((addr) => isSameAddress(addr, tx.to))) {
    throw asBridgeError(new InvalidBridgeContractError(
      'router',
      aggregatorId,
      fromChainId,
      expectedRouter || allowedRouters.join(',') || 'configured router',
      tx.to,
      bridgeId
    ), BRIDGE_ERRORS.ROUTER_NOT_ALLOWED, calldataDiagnostics(tx.data));
  }
};

const checkBridgeTx = (
  aggregatorId: BridgeAggregatorId, fromChainId: string, bridgeId: string, tx: BridgeTx,
  expectation?: BridgeCallExpectation, options: BridgeValidationOptions = {},
  operation: 'buildTx' | 'verifyTx' = 'verifyTx'
): BridgeCheck | undefined => {
  const context = { aggregatorId, chainId: fromChainId, toChainId: expectation?.toChainId, bridgeId, operation,
    ...calldataDiagnostics(tx.data) };
  // A configured-router mismatch was already blocking on main; never suppress it.
  if (options.lite) validateBridgeRouter(aggregatorId, fromChainId, bridgeId, tx, true);
  try { validateBridgeRouter(aggregatorId, fromChainId, bridgeId, tx); }
  catch (error) { handleNewValidationError(error, options, context); }

  if (CALLDATA_AGGREGATORS.includes(aggregatorId) || options.lite) {
    let check: BridgeCheck;
    try { check = validateBridgeCalldata(aggregatorId, fromChainId, tx, expectation); }
    catch (error) { handleNewValidationError(error, options, context); return undefined; }
    if (!check.ok) {
      handleNewValidationError(new InvalidBridgeCalldataError(
        aggregatorId,
        fromChainId,
        check.method,
        check.reason || BRIDGE_ERRORS.INVALID_CALLDATA.message,
        check.errors.map((error) => ({ ...error, bridgeId }))
      ), options, context);
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
  expectation?: BridgeCallExpectation,
  options: BridgeValidationOptions = {}
) => {
  checkBridgeTx(aggregatorId, fromChainId, bridgeId, tx, expectation, options);
  return true;
};

export const getQuote = async (
  aggregatorId: string,
  params: BridgeQuoteListParams,
  api: BridgeApi
): Promise<BridgeQuoteListItem[]> => {
  try {
    params = { ...params };
    assertSupported(aggregatorId, params.fromChainId);
    let assertContext: (() => void) | undefined;
    try { assertContext = params.providerClient?.captureContext(); }
    catch (error) { handleNewValidationError(error, params, { aggregatorId, chainId: params.fromChainId, toChainId: params.toChainId, operation: 'getQuote' }); }

    if (aggregatorId === BRIDGE_ENUM.RELAY && !params.lite) {
      if (!params.providerClient) throw new InvalidBridgeProviderError('relay', BRIDGE_ERRORS.DIRECT_PROVIDER_CLIENT_IS_REQUIRED);
      const quotes = await params.providerClient.getQuotes('relay', params);
      try { assertContext?.(); }
      catch (error) { handleNewValidationError(error, params, { aggregatorId, chainId: params.fromChainId, toChainId: params.toChainId, operation: 'getQuote' }); }
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
        ? api.getBridgeQuoteListV2(baseParams).catch((error) => { throw asBridgeError(error, BRIDGE_ERRORS.BACKEND_QUOTE_REQUEST_FAILED, { requestKind: 'backend_quote' }); })
        : api.getBridgeQuoteV2?.(baseParams).catch((error) => { throw asBridgeError(error, BRIDGE_ERRORS.BACKEND_QUOTE_REQUEST_FAILED, { requestKind: 'backend_quote' }); }),
      aggregatorId === BRIDGE_ENUM.SOCKET && params.providerClient && !params.lite
        ? params.providerClient.getQuotes('socket', params).catch((error) => {
            if (error instanceof InvalidBridgeProviderError) {
              reportBridgeError(params.onError, error, { aggregatorId, chainId: params.fromChainId, toChainId: params.toChainId, operation: 'getQuote' });
              return [];
            }
            throw error;
          })
        : Promise.resolve([]),
    ]);
    try { assertContext?.(); }
    catch (error) { handleNewValidationError(error, params, { aggregatorId, chainId: params.fromChainId, toChainId: params.toChainId, operation: 'getQuote' }); }

    if (!backendQuotes) {
      throw new BridgeError(BRIDGE_ERRORS.MISSING_QUOTE_API);
    }
    const quotes = [
      ...backendQuotes.filter((quote) => !(aggregatorId === BRIDGE_ENUM.SOCKET && params.providerClient && !params.lite &&
        SOCKET_PROVIDER_ROUTES.includes(quote.bridge_id))),
      ...providerQuotes,
    ];

    return quotes.filter((quote) => {
      try {
        validateBridgeQuote(aggregatorId, params.fromChainId, quote, params);
        return true;
      } catch (error) {
        if (error instanceof InvalidBridgeContractError) {
          reportBridgeError(params.onError, error, { aggregatorId, chainId: params.fromChainId, toChainId: params.toChainId, bridgeId: quote.bridge_id, operation: 'getQuote', ...(params.lite ? { lite: true, blocking: true } : {}) });
          return false;
        }
        throw error;
      }
    });
  } catch (error) {
    throw asBridgeError(error, BRIDGE_ERRORS.UNKNOWN, { aggregatorId, chainId: params.fromChainId, toChainId: params.toChainId, operation: 'getQuote', ...(params.lite ? { lite: true, blocking: true } : {}) });
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
    let assertContext: (() => void) | undefined;
    try { assertContext = params.providerClient?.captureContext(); }
    catch (error) { handleNewValidationError(error, params, { aggregatorId, chainId: params.fromChainId, toChainId: params.toChainId, operation: 'buildTx' }); }

    if (!params.lite && (aggregatorId === BRIDGE_ENUM.RELAY ||
        (aggregatorId === BRIDGE_ENUM.SOCKET && SOCKET_PROVIDER_ROUTES.includes(params.bridgeId)))) {
      if (!params.providerClient) throw new InvalidBridgeProviderError(aggregatorId, BRIDGE_ERRORS.DIRECT_PROVIDER_CLIENT_IS_REQUIRED);
      const tx = await params.providerClient.buildTx(aggregatorId as 'relay' | 'socket', params);
      try { assertContext?.(); }
      catch (error) { handleNewValidationError(error, params, { aggregatorId, chainId: params.fromChainId, toChainId: params.toChainId, operation: 'buildTx' }); }
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
        }).catch((error) => { throw asBridgeError(error, BRIDGE_ERRORS.BACKEND_BUILD_REQUEST_FAILED, { requestKind: 'backend_build' }); })
      : (
          await api.getBridgeQuoteTxV2?.({
            ...buildParams,
          }).catch((error) => { throw asBridgeError(error, BRIDGE_ERRORS.BACKEND_BUILD_REQUEST_FAILED, { requestKind: 'backend_build' }); })
        )?.tx;

    if (!tx) {
      throw new BridgeError(BRIDGE_ERRORS.MISSING_BUILD_API);
    }
    try { assertContext?.(); }
    catch (error) { handleNewValidationError(error, params, { aggregatorId, chainId: params.fromChainId, toChainId: params.toChainId, operation: 'buildTx' }); }

    const expectation: BridgeCallExpectation = {
      userAddress: params.userAddress,
      fromTokenId: params.fromTokenId,
      fromTokenRawAmount: params.fromTokenRawAmount,
      toChainId: params.toChainId,
      toTokenId: params.toTokenId,
      toTokenRawAmount: params.toTokenRawAmount ?? quotedToAmount(params.quoteKey),
      slippage: params.slippage,
    };
    const check = checkBridgeTx(aggregatorId, params.fromChainId, params.bridgeId, tx, expectation, params, 'buildTx');

    // A backend may mislabel bridge_id. Decide from calldata as well, so renaming
    // an RFQ/CCTP/LayerSwap route cannot bypass the provider requirement.
    const parsed = check?.parsed;
    if (params.lite && (aggregatorId === BRIDGE_ENUM.RELAY ||
        (aggregatorId === BRIDGE_ENUM.SOCKET && SOCKET_PROVIDER_ROUTES.includes(params.bridgeId)))) {
      try {
        if (!params.providerClient) throw new InvalidBridgeProviderError(aggregatorId, BRIDGE_ERRORS.DIRECT_PROVIDER_CLIENT_IS_REQUIRED);
        params.providerClient.verifyTx(aggregatorId as 'relay' | 'socket', params, tx);
      } catch (error) {
        handleNewValidationError(error, params, { aggregatorId, chainId: params.fromChainId,
          toChainId: params.toChainId, bridgeId: params.bridgeId, operation: 'buildTx' });
      }
      return tx;
    }
    try {
      if (aggregatorId === BRIDGE_ENUM.LIFI && parsed?.method.endsWith('ViaLayerSwap')) {
        if (!params.providerClient) throw new InvalidBridgeProviderError('layerswap', BRIDGE_ERRORS.DIRECT_PROVIDER_CLIENT_IS_REQUIRED);
        const verification = params.providerClient.verifyLayerSwapTx({
          ...params, toTokenRawAmount: expectation.toTokenRawAmount,
        }, params.lite ? { ...tx } : tx);
        if (params.lite) {
          void verification.then(() => assertContext?.()).catch((error) => {
            handleNewValidationError(error, params, { aggregatorId, chainId: params.fromChainId,
              toChainId: params.toChainId, bridgeId: params.bridgeId, operation: 'buildTx' });
          });
          return tx;
        }
        await verification;
        try { assertContext?.(); }
        catch (error) { handleNewValidationError(error, params, { aggregatorId, chainId: params.fromChainId, toChainId: params.toChainId, operation: 'buildTx' }); }
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
    } catch (error) {
      handleNewValidationError(error, params, { aggregatorId, chainId: params.fromChainId,
        toChainId: params.toChainId, bridgeId: params.bridgeId, operation: 'buildTx' });
    }

    return tx;
  } catch (error) {
    throw asBridgeError(error, BRIDGE_ERRORS.UNKNOWN, { aggregatorId, chainId: params.fromChainId, toChainId: params.toChainId, operation: 'buildTx', bridgeId: params.bridgeId, ...(params.lite ? { lite: true, blocking: true } : {}) });
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
          reportBridgeError(params.onError, error, { aggregatorId, chainId: params.fromChainId, toChainId: params.toChainId, bridgeId: quote.bridge_id, operation: 'buildTx', ...(params.lite ? { lite: true, blocking: true } : {}) });
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
