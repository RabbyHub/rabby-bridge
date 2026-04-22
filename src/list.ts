import { CHAINS_ENUM, normalizeChainEnum } from './chains.js';
import { BRIDGE_AGGREGATORS } from './consts.js';
import type { BridgeAggregatorId } from './consts.js';
import type { ChainEnum } from './chains.js';
import {
  BRIDGE_SUPPORT_CHAINS_DATA,
  BRIDGE_ROUTER_WHITELIST_DATA,
  BRIDGE_SPENDER_WHITELIST_DATA,
} from './data.js';

export { CHAINS_ENUM };

export type BridgeContractMap = Record<string, Partial<Record<ChainEnum, string>>>;

export const BRIDGE_SPENDER_WHITELIST =
  BRIDGE_SPENDER_WHITELIST_DATA as BridgeContractMap;

export const BRIDGE_ROUTER_WHITELIST =
  BRIDGE_ROUTER_WHITELIST_DATA as BridgeContractMap;

export const BRIDGE_SUPPORT_CHAINS = Object.fromEntries(
  BRIDGE_AGGREGATORS.map((aggregatorId: BridgeAggregatorId) => {
    const chainEnums = new Set<ChainEnum>([
      ...((Object.keys(
        BRIDGE_ROUTER_WHITELIST[aggregatorId] || {}
      ) as ChainEnum[])),
      ...((Object.keys(
        BRIDGE_SPENDER_WHITELIST[aggregatorId] || {}
      ) as ChainEnum[])),
      ...((BRIDGE_SUPPORT_CHAINS_DATA as Partial<
        Record<BridgeAggregatorId, readonly ChainEnum[]>
      >)[aggregatorId] || []),
    ]);

    return [
      aggregatorId,
      Array.from(chainEnums) as ChainEnum[],
    ];
  })
) as Record<BridgeAggregatorId, ChainEnum[]>;

export const ALL_SUPPORTED_BRIDGE_CHAINS = Array.from(
  new Set(Object.values(BRIDGE_SUPPORT_CHAINS).flat())
) as ChainEnum[];

export const isSupportedBridgeAggregator = (
  aggregatorId: string
): aggregatorId is BridgeAggregatorId => {
  return BRIDGE_AGGREGATORS.includes(aggregatorId as BridgeAggregatorId);
};

export const isSupportedBridgeChain = (
  aggregatorId: BridgeAggregatorId,
  chainId: string
) => {
  const chainEnum = normalizeChainEnum(chainId);
  if (!chainEnum) {
    return false;
  }

  return BRIDGE_SUPPORT_CHAINS[aggregatorId]?.includes(chainEnum) || false;
};

export const getBridgeSpender = (
  aggregatorId: BridgeAggregatorId,
  chainId: string
) => {
  const chainEnum = normalizeChainEnum(chainId);
  if (!chainEnum) {
    return undefined;
  }

  return (BRIDGE_SPENDER_WHITELIST[aggregatorId] as Record<string, string> | undefined)?.[
    chainEnum
  ];
};

export const getBridgeRouter = (
  aggregatorId: BridgeAggregatorId,
  chainId: string
) => {
  const chainEnum = normalizeChainEnum(chainId);
  if (!chainEnum) {
    return undefined;
  }

  return (BRIDGE_ROUTER_WHITELIST[aggregatorId] as Record<string, string> | undefined)?.[
    chainEnum
  ];
};
