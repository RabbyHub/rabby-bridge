import type { OpenApiService } from '@rabby-wallet/rabby-api';
import { BRIDGE_ENUM } from './consts.js';
import type { BridgeAggregatorId } from './consts.js';
import {
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
}

export interface BridgeBuildTxParams extends BridgeQuoteListParams {
  bridgeId: string;
  quoteKey?: string | Record<string, unknown>;
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

export class InvalidBridgeContractError extends Error {
  constructor(
    public readonly kind: 'spender' | 'router',
    public readonly aggregatorId: BridgeAggregatorId,
    public readonly chainId: string,
    public readonly expected: string,
    public readonly received: string,
    public readonly bridgeId?: string
  ) {
    super(
      `Invalid bridge ${kind} for ${aggregatorId} on ${chainId}: expected ${expected}, got ${received}`
    );
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
    throw new Error(`${aggregatorId} is not supported`);
  }
  if (!isSupportedBridgeChain(aggregatorId, fromChainId)) {
    throw new Error(`${aggregatorId} does not support ${fromChainId}`);
  }
}

const requireSlippage = (slippage?: string) => {
  if (!slippage) {
    throw new Error('slippage is required for this API call');
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

  if (!expectedSpender || !receivedSpender) {
    return true;
  }

  if (!isSameAddress(expectedSpender, receivedSpender)) {
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

export const validateBridgeTx = (
  aggregatorId: BridgeAggregatorId,
  fromChainId: string,
  bridgeId: string,
  tx: BridgeTx
) => {
  if (!shouldValidateBridgeContracts(aggregatorId)) {
    return true;
  }

  const expectedRouter = getBridgeRouter(aggregatorId, fromChainId);

  if (!expectedRouter) {
    return true;
  }

  if (!isSameAddress(expectedRouter, tx.to)) {
    throw new InvalidBridgeContractError(
      'router',
      aggregatorId,
      fromChainId,
      expectedRouter,
      tx.to,
      bridgeId
    );
  }

  return true;
};

export const getQuote = async (
  aggregatorId: string,
  params: BridgeQuoteListParams,
  api: BridgeApi
): Promise<BridgeQuoteListItem[]> => {
  assertSupported(aggregatorId, params.fromChainId);

  const baseParams = {
    aggregator_id: aggregatorId,
    user_addr: params.userAddress,
    from_chain_id: params.fromChainId,
    from_token_id: params.fromTokenId,
    from_token_raw_amount: params.fromTokenRawAmount,
    to_chain_id: params.toChainId,
    to_token_id: params.toTokenId,
  };

  const quotes = api.getBridgeQuoteListV2
    ? await api.getBridgeQuoteListV2(baseParams)
    : await api.getBridgeQuoteV2?.({
        ...baseParams,
        slippage: requireSlippage(params.slippage),
      });

  if (!quotes) {
    throw new Error('Bridge API does not provide a quote list method');
  }

  return quotes.filter((quote) => {
    try {
      validateBridgeQuote(aggregatorId, params.fromChainId, quote);
      return true;
    } catch (error) {
      if (error instanceof InvalidBridgeContractError) {
        return false;
      }
      throw error;
    }
  });
};

export const buildTx = async (
  aggregatorId: string,
  params: BridgeBuildTxParams,
  api: BridgeApi
): Promise<BridgeTx> => {
  assertSupported(aggregatorId, params.fromChainId);

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
      })
    : (
        await api.getBridgeQuoteTxV2?.({
          ...buildParams,
        })
      )?.tx;

  if (!tx) {
    throw new Error('Bridge API does not provide a build tx method');
  }

  validateBridgeTx(aggregatorId, params.fromChainId, params.bridgeId, tx);

  return tx;
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
          },
          api
        );

        return {
          ...quote,
          tx,
        };
      } catch (error) {
        if (error instanceof InvalidBridgeContractError) {
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
