import { BRIDGE_ERRORS, BridgeError, asBridgeError, reportBridgeError } from './errors/index.js';
import { InvalidBridgeCalldataError } from './calldata/index.js';
import type { BridgeCallExpectation } from './calldata/expect.js';
import type { BridgeAggregatorId } from './consts.js';
import { isSupportedBridgeAggregator, isSupportedBridgeChain } from './list.js';
import { checkBridgeTx, InvalidBridgeContractError, validateBridgeQuote } from './validation.js';
import type {
  BridgeApi,
  BridgeBuildTxParams,
  BridgeQuoteListItem,
  BridgeQuoteListParams,
  BridgeTx,
} from './types.js';

export { InvalidBridgeContractError, validateBridgeQuote, validateBridgeTx } from './validation.js';
export type {
  BridgeApi,
  BridgeBuildTxParams,
  BridgeQuote,
  BridgeQuoteListItem,
  BridgeQuoteListParams,
  BridgeValidationOptions,
  BridgeValidationResult,
  BridgeTx,
} from './types.js';

// ---- 请求参数 ----

function assertSupported(
  aggregatorId: string,
  fromChainId: string,
): asserts aggregatorId is BridgeAggregatorId {
  if (!isSupportedBridgeAggregator(aggregatorId)) {
    const error = new BridgeError(BRIDGE_ERRORS.UNSUPPORTED_BRIDGE_AGGREGATOR, {
      aggregatorId,
      chainId: fromChainId,
    });
    error.message = `${aggregatorId} is not supported`;
    throw error;
  }
  if (!isSupportedBridgeChain(aggregatorId, fromChainId)) {
    const error = new BridgeError(BRIDGE_ERRORS.UNSUPPORTED_SOURCE_CHAIN, {
      aggregatorId,
      chainId: fromChainId,
    });
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

const readBuildAttachment = (
  value: unknown,
): { tx?: BridgeTx; orderData?: unknown } => {
  if (!value || typeof value !== 'object') return {};
  const record = value as BridgeTx & { tx?: BridgeTx; order_data?: unknown };
  const wrapped = Boolean(record.tx && !record.to && !record.data);
  return {
    tx: wrapped ? record.tx : (record as BridgeTx),
    orderData: record.order_data,
  };
};

const stringifyQuoteKey = (quoteKey?: string | Record<string, unknown>) => {
  if (typeof quoteKey === 'string') {
    return quoteKey;
  }
  return JSON.stringify(quoteKey || {});
};

const quotedToAmount = (quoteKey?: string | Record<string, unknown>) => {
  let key = quoteKey;
  if (typeof key === 'string') {
    try {
      key = JSON.parse(key);
    } catch {
      return undefined;
    }
  }
  if (!key || typeof key !== 'object' || Array.isArray(key)) return undefined;
  const amount = key.to_token_raw_amount;
  if (
    typeof amount === 'string' ||
    (typeof amount === 'number' && Number.isSafeInteger(amount))
  ) {
    return String(amount);
  }
  return undefined;
};

// ---- 报价与交易接口 ----

export const getQuote = async (
  aggregatorId: string,
  params: BridgeQuoteListParams,
  api: BridgeApi,
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
      ? await api.getBridgeQuoteListV2(baseParams).catch((error) => {
          throw asBridgeError(
            error,
            BRIDGE_ERRORS.BACKEND_QUOTE_REQUEST_FAILED,
            { requestKind: 'backend_quote' },
          );
        })
      : await api.getBridgeQuoteV2?.(baseParams).catch((error) => {
          throw asBridgeError(
            error,
            BRIDGE_ERRORS.BACKEND_QUOTE_REQUEST_FAILED,
            { requestKind: 'backend_quote' },
          );
        });
    if (!quotes) throw new BridgeError(BRIDGE_ERRORS.MISSING_QUOTE_API);

    return quotes.filter((quote) => {
      try {
        validateBridgeQuote(aggregatorId, params.fromChainId, quote);
        return true;
      } catch (error) {
        if (error instanceof InvalidBridgeContractError) {
          reportBridgeError(params.onError, error, {
            aggregatorId,
            chainId: params.fromChainId,
            toChainId: params.toChainId,
            bridgeId: quote.bridge_id,
            operation: 'getQuote',
          });
          return false;
        }
        throw error;
      }
    });
  } catch (error) {
    throw asBridgeError(error, BRIDGE_ERRORS.UNKNOWN, {
      aggregatorId,
      chainId: params.fromChainId,
      toChainId: params.toChainId,
      operation: 'getQuote',
    });
  }
};

export const buildTx = async (
  aggregatorId: string,
  params: BridgeBuildTxParams,
  api: BridgeApi,
): Promise<BridgeTx> => {
  try {
    // 请求前固定用户意图，避免等待期间被修改。
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
      // 旧接口会重新询价，不绑定原报价 ID。
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

    const built = api.buildBridgeTx
      ? await api
          .buildBridgeTx({
            ...buildParams,
            quote_key: quoteKey,
          })
          .catch((error) => {
            throw asBridgeError(
              error,
              BRIDGE_ERRORS.BACKEND_BUILD_REQUEST_FAILED,
              { requestKind: 'backend_build' },
            );
          })
      : await api
          .getBridgeQuoteTxV2?.({
            ...buildParams,
          })
          .catch((error) => {
            throw asBridgeError(
              error,
              BRIDGE_ERRORS.BACKEND_BUILD_REQUEST_FAILED,
              { requestKind: 'backend_build' },
            );
          });
    const attached = readBuildAttachment(built);
    const tx = attached.tx;

    if (!tx) {
      throw new BridgeError(BRIDGE_ERRORS.MISSING_BUILD_API);
    }
    checkBridgeTx(
      aggregatorId,
      params.fromChainId,
      params.bridgeId,
      tx,
      {
        ...expectation,
        orderData: attached.orderData ?? params.orderData,
      },
      params,
      'buildTx',
    );

    return tx;
  } catch (error) {
    throw asBridgeError(error, BRIDGE_ERRORS.UNKNOWN, {
      aggregatorId,
      chainId: params.fromChainId,
      toChainId: params.toChainId,
      operation: 'buildTx',
      bridgeId: params.bridgeId,
    });
  }
};

export const getQuoteListWithTx = async (
  aggregatorId: string,
  params: BridgeQuoteListParams,
  api: BridgeApi,
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
              toTokenRawAmount:
                quote.to_token_raw_amount_hex_str ??
                (Number.isSafeInteger(quote.to_token_raw_amount)
                  ? String(quote.to_token_raw_amount)
                  : undefined),
            },
            api,
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
            // Calldata 校验失败已上报，避免重复。
            if (error instanceof InvalidBridgeContractError) {
              reportBridgeError(params.onError, error, {
                aggregatorId,
                chainId: params.fromChainId,
                toChainId: params.toChainId,
                bridgeId: quote.bridge_id,
                operation: 'buildTx',
              });
            }
            return null;
          }
          throw error;
        }
      }),
    );

  return settled.filter(
    (quote): quote is BridgeQuoteListItem & { tx: BridgeTx } => quote !== null,
  );
};

export const getQuoteList = getQuote;

export const buildBridgeQuoteTx = buildTx;
