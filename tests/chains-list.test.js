import { describe, expect, test } from '@jest/globals';

import {
  ALL_SUPPORTED_BRIDGE_CHAINS,
  BRIDGE_ENUM,
  BRIDGE_SUPPORT_CHAINS,
  CHAINS_ENUM,
  getBridgeRouter,
  getBridgeSpender,
  isSupportedBridgeAggregator,
  isSupportedBridgeChain,
} from '../dist/index.js';
import {
  CHAIN_ENUM_TO_SERVER_ID,
  SERVER_ID_TO_CHAIN_ENUM,
  normalizeChainEnum,
} from '../dist/chains.js';

describe('chain normalization', () => {
  test('accepts canonical chain enums and server ids case-insensitively', () => {
    expect(normalizeChainEnum(CHAINS_ENUM.ETH)).toBe(CHAINS_ENUM.ETH);
    expect(normalizeChainEnum('eth')).toBe(CHAINS_ENUM.ETH);
    expect(normalizeChainEnum('ETH')).toBe(CHAINS_ENUM.ETH);
    expect(normalizeChainEnum('bera')).toBe('BERA');
    expect(normalizeChainEnum('BERA')).toBe('BERA');
    expect(normalizeChainEnum('not-a-chain')).toBeUndefined();
  });

  test('preserves server id round-tripping for built-in chains', () => {
    expect(SERVER_ID_TO_CHAIN_ENUM.eth).toBe(CHAINS_ENUM.ETH);
    expect(CHAIN_ENUM_TO_SERVER_ID[CHAINS_ENUM.ETH]).toBe('eth');
  });
});

describe('bridge allowlists', () => {
  test('recognizes supported aggregators and chains', () => {
    expect(isSupportedBridgeAggregator(BRIDGE_ENUM.LIFI)).toBe(true);
    expect(isSupportedBridgeAggregator('unknown')).toBe(false);

    expect(isSupportedBridgeChain(BRIDGE_ENUM.LIFI, 'eth')).toBe(true);
    expect(isSupportedBridgeChain(BRIDGE_ENUM.NEAR_INTENTS, 'bera')).toBe(true);
    expect(isSupportedBridgeChain(BRIDGE_ENUM.NEAR_INTENTS, 'not-a-chain')).toBe(
      false
    );
  });

  test('exposes merged supported chain lists', () => {
    expect(BRIDGE_SUPPORT_CHAINS[BRIDGE_ENUM.LIFI]).toContain(CHAINS_ENUM.ETH);
    expect(BRIDGE_SUPPORT_CHAINS[BRIDGE_ENUM.NEAR_INTENTS]).toContain('BERA');
    expect(ALL_SUPPORTED_BRIDGE_CHAINS).toContain('BERA');
    expect(ALL_SUPPORTED_BRIDGE_CHAINS).toContain(CHAINS_ENUM.ETH);
  });

  test('returns spender and router addresses with normalized chain ids', () => {
    const expectedLifiEth = '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae';

    expect(getBridgeSpender(BRIDGE_ENUM.LIFI, 'eth')).toBe(expectedLifiEth);
    expect(getBridgeRouter(BRIDGE_ENUM.LIFI, CHAINS_ENUM.ETH)).toBe(
      expectedLifiEth
    );
    expect(getBridgeSpender(BRIDGE_ENUM.NEAR_INTENTS, 'eth')).toBeUndefined();
    expect(getBridgeRouter(BRIDGE_ENUM.LIFI, 'not-a-chain')).toBeUndefined();
  });

  test('exposes mayan aggregator with forwarder contract', () => {
    const mayanForwarder = '0x337685fdab40d39bd02028545a4ffa7d287cc3e2';

    expect(isSupportedBridgeAggregator(BRIDGE_ENUM.MAYAN)).toBe(true);
    expect(isSupportedBridgeChain(BRIDGE_ENUM.MAYAN, 'eth')).toBe(true);
    expect(isSupportedBridgeChain(BRIDGE_ENUM.MAYAN, 'arb')).toBe(true);
    expect(getBridgeSpender(BRIDGE_ENUM.MAYAN, 'eth')).toBe(mayanForwarder);
    expect(getBridgeRouter(BRIDGE_ENUM.MAYAN, 'arb')).toBe(mayanForwarder);
  });
});
