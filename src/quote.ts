import type { BridgeErrorContext, BridgeErrorDefinition, BridgeErrorReporter } from './errors/index.js';
import { BRIDGE_ERRORS, BridgeError, asBridgeError, reportBridgeError } from './errors/index.js';
import type { OpenApiService } from '@rabby-wallet/rabby-api';
import {
  InvalidBridgeCalldataError,
  validateBridgeCalldata,
} from './calldata/index.js';
import type { BridgeCallExpectation } from './calldata/expect.js';
import type { BridgeCheck } from './calldata/types.js';
import { calldataDiagnostics } from './calldata/diagnostics.js';
import { sanitizeBridgeError } from './errors/sanitize.js';
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
  /** Retains the legacy missing-spender rollout behavior. Calldata checks are always observation-only. */
  lite?: boolean;
  /** Receives filtered failures and non-blocking local validation observations. */
  onError?: BridgeErrorReporter;
}

export type BridgeValidationResult = {
  /** First rollout: only the router decides whether a transaction passes. */
  pass: boolean;
  routerPass: boolean;
  fromPass: boolean;
  toPass: boolean;
  receiverPass: boolean;
  unverifiedFields: string[];
  errors: BridgeCheck['errors'];
};

export interface BridgeQuoteListParams extends BridgeValidationOptions {
  userAddress: string;
  fromChainId: string;
  fromTokenId: string;
  fromTokenRawAmount: string;
  toChainId: string;
  toTokenId: string;
  slippage?: string;
  feeRate?: number;
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
  tx: BridgeTx
): true => {
  if (!shouldValidateBridgeContracts(aggregatorId)) {
    return true;
  }

  const expectedRouter = getBridgeRouter(aggregatorId, fromChainId);
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
    ), BRIDGE_ERRORS.ROUTER_NOT_ALLOWED, { ...calldataDiagnostics(tx.data),
      pass: false, routerPass: false, fromPass: false, toPass: false, receiverPass: false, blocking: true });
  }
  return true;
};

const fieldErrors: Record<'fromPass' | 'toPass' | 'receiverPass', BridgeErrorDefinition[]> = {
  fromPass: [BRIDGE_ERRORS.FROM_ADDRESS_MISMATCH, BRIDGE_ERRORS.FROM_CHAIN_MISMATCH,
    BRIDGE_ERRORS.FROM_TOKEN_MISMATCH, BRIDGE_ERRORS.FROM_AMOUNT_MISMATCH,
    BRIDGE_ERRORS.DEPOSITOR_MISMATCH, BRIDGE_ERRORS.MISSING_SOURCE_TOKEN, BRIDGE_ERRORS.MISSING_SOURCE_AMOUNT],
  toPass: [BRIDGE_ERRORS.TO_CHAIN_MISMATCH, BRIDGE_ERRORS.TO_TOKEN_MISMATCH,
    BRIDGE_ERRORS.MIN_RECEIVE_MISMATCH, BRIDGE_ERRORS.MISSING_DESTINATION,
    BRIDGE_ERRORS.MISSING_DESTINATION_CHAIN, BRIDGE_ERRORS.MISSING_OUTPUT_TOKEN,
    BRIDGE_ERRORS.MISSING_MIN_OUTPUT, BRIDGE_ERRORS.UNSUPPORTED_DESTINATION_CALL],
  receiverPass: [BRIDGE_ERRORS.RECEIVER_MISMATCH, BRIDGE_ERRORS.MISSING_RECEIVER,
    BRIDGE_ERRORS.UNSUPPORTED_DESTINATION_CALL],
};

const bindingErrors: BridgeErrorDefinition[] = [
  BRIDGE_ERRORS.QUOTE_ID_MISMATCH, BRIDGE_ERRORS.REQUEST_ID_MISMATCH, BRIDGE_ERRORS.SOCKET_RFQ_QUOTE_ID_MISMATCH,
];

const checkBridgeTx = (
  aggregatorId: BridgeAggregatorId, fromChainId: string, bridgeId: string, tx: BridgeTx,
  expectation?: BridgeCallExpectation, options: BridgeValidationOptions = {},
  operation: 'buildTx' | 'verifyTx' = 'verifyTx'
): BridgeValidationResult => {
  const routerPass = validateBridgeRouter(aggregatorId, fromChainId, bridgeId, tx);
  let check: BridgeCheck;
  try { check = validateBridgeCalldata(aggregatorId, fromChainId, tx, expectation); }
  catch (error) {
    check = { ok: false, aggregatorId, errors: asBridgeError(error, BRIDGE_ERRORS.INVALID_CALLDATA).errors };
  }
  const unverifiedFields = check.unverifiedFields ?? [
    'sourceToken', 'sourceAmount', 'outputToken', 'minOutputAmount', 'receiver',
    ...(expectation?.toChainId ? ['destinationChainId'] : []),
  ];
  const externalDestination = check.parsed && (aggregatorId === BRIDGE_ENUM.RELAY ||
    (aggregatorId === BRIDGE_ENUM.SOCKET &&
      ['receiveERC20', 'receiveNative', 'depositForBurn'].includes(check.parsed.protocolMethod ?? '')));
  // Known local limits remain unverified, without repeating an expected gap as an error.
  const reportableFields = unverifiedFields.filter((field) => {
    if (!check.parsed) return true;
    if (field === 'outputToken') return false;
    if (field === 'minOutputAmount') return check.parsed.minOutputAmount !== undefined;
    return !(externalDestination && ['receiver', 'destinationChainId'].includes(field));
  });
  // Unclassified structure failures invalidate every field; known field failures stay separate.
  const comparable = Boolean(expectation && check.parsed) && check.errors.every((error) =>
    bindingErrors.some((item) => item.error_code === error.error_code) ||
    Object.values(fieldErrors).some((group) => group.some((item) => item.error_code === error.error_code)));
  const fieldPass = (field: keyof typeof fieldErrors, required: string[]) => comparable &&
    required.every((item) => !unverifiedFields.includes(item)) &&
    !check.errors.some((error) => fieldErrors[field].some((item) => item.error_code === error.error_code));
  const flags = {
    // shortcut: field checks are observation-only until collected routes justify enforcement.
    pass: routerPass, routerPass,
    fromPass: fieldPass('fromPass', ['sourceToken', 'sourceAmount']),
    toPass: fieldPass('toPass', ['outputToken', 'minOutputAmount', ...(expectation?.toChainId ? ['destinationChainId'] : [])]),
    receiverPass: fieldPass('receiverPass', ['receiver']),
  };
  const context: BridgeErrorContext = {
    ...check.parsed?.diagnostics, ...calldataDiagnostics(tx.data), aggregatorId,
    chainId: fromChainId, toChainId: expectation?.toChainId, bridgeId, operation, method: check.method,
    ...(check.parsed ? { hasDestinationCall: Boolean(check.parsed.hasDestinationCall || check.parsed.destinationCallData !== undefined) } : {}),
    ...flags, lite: Boolean(options.lite), blocking: false,
  };
  const errors = [
    ...check.errors,
    ...(reportableFields.length ? [{ ...BRIDGE_ERRORS.UNVERIFIED_BRIDGE_FIELDS, unverifiedFields: reportableFields }] : []),
  ].map((error) => sanitizeBridgeError({ ...error, ...context }));
  if (errors.length) {
    reportBridgeError(options.onError, new InvalidBridgeCalldataError(aggregatorId, fromChainId,
      check.method, check.reason || errors[0].message, errors), context);
  }
  return { ...flags, unverifiedFields, errors };
};

export const validateBridgeTx = (
  aggregatorId: BridgeAggregatorId,
  fromChainId: string,
  bridgeId: string,
  tx: BridgeTx,
  expectation?: BridgeCallExpectation,
  options: BridgeValidationOptions = {}
): BridgeValidationResult => checkBridgeTx(aggregatorId, fromChainId, bridgeId, tx, expectation, options);

export const getQuote = async (
  aggregatorId: string,
  params: BridgeQuoteListParams,
  api: BridgeApi
): Promise<BridgeQuoteListItem[]> => {
  try {
    params = { ...params };
    assertSupported(aggregatorId, params.fromChainId);
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

    const quotes = api.getBridgeQuoteListV2
      ? await api.getBridgeQuoteListV2(baseParams).catch((error) => { throw asBridgeError(error, BRIDGE_ERRORS.BACKEND_QUOTE_REQUEST_FAILED, { requestKind: 'backend_quote' }); })
      : await api.getBridgeQuoteV2?.(baseParams).catch((error) => { throw asBridgeError(error, BRIDGE_ERRORS.BACKEND_QUOTE_REQUEST_FAILED, { requestKind: 'backend_quote' }); });
    if (!quotes) throw new BridgeError(BRIDGE_ERRORS.MISSING_QUOTE_API);

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
    const quoteKey = stringifyQuoteKey(params.quoteKey);
    const expectation: BridgeCallExpectation = {
      userAddress: params.userAddress,
      fromTokenId: params.fromTokenId,
      fromTokenRawAmount: params.fromTokenRawAmount,
      toChainId: params.toChainId,
      toTokenId: params.toTokenId,
      toTokenRawAmount: params.toTokenRawAmount ?? quotedToAmount(quoteKey),
      // The legacy quote+tx API requotes instead of reusing this selection.
      quoteKey: typeof api.buildBridgeTx === 'function' ? quoteKey : undefined,
      slippage: params.slippage,
    };
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
          quote_key: quoteKey,
        }).catch((error) => { throw asBridgeError(error, BRIDGE_ERRORS.BACKEND_BUILD_REQUEST_FAILED, { requestKind: 'backend_build' }); })
      : (
          await api.getBridgeQuoteTxV2?.({
            ...buildParams,
          }).catch((error) => { throw asBridgeError(error, BRIDGE_ERRORS.BACKEND_BUILD_REQUEST_FAILED, { requestKind: 'backend_build' }); })
        )?.tx;

    if (!tx) {
      throw new BridgeError(BRIDGE_ERRORS.MISSING_BUILD_API);
    }
    checkBridgeTx(aggregatorId, params.fromChainId, params.bridgeId, tx, expectation, params, 'buildTx');

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
          error instanceof InvalidBridgeCalldataError
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
