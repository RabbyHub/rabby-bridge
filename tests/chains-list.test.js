import { describe, expect, test } from '@jest/globals';

import {
  ALL_SUPPORTED_BRIDGE_CHAINS,
  BRIDGE_ENUM,
  BRIDGE_SUPPORT_CHAINS,
  CHAINS_ENUM,
  getBridgeAltContracts,
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
    expect(normalizeChainEnum('hood')).toBe('HOOD');
    expect(normalizeChainEnum('HOOD')).toBe('HOOD');
    expect(normalizeChainEnum('not-a-chain')).toBeUndefined();
  });

  test('preserves server id round-tripping for built-in chains', () => {
    expect(SERVER_ID_TO_CHAIN_ENUM.eth).toBe(CHAINS_ENUM.ETH);
    expect(CHAIN_ENUM_TO_SERVER_ID[CHAINS_ENUM.ETH]).toBe('eth');
    expect(SERVER_ID_TO_CHAIN_ENUM.hood).toBe('HOOD');
    expect(CHAIN_ENUM_TO_SERVER_ID.HOOD).toBe('hood');
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

  test('exposes socket v3 allowance holder on verified chains', () => {
    const socketAllowanceHolder =
      '0x50c4e75a512f2a14a7b304787adf79c4531a5909';

    expect(isSupportedBridgeAggregator(BRIDGE_ENUM.SOCKET)).toBe(true);
    expect(isSupportedBridgeChain(BRIDGE_ENUM.SOCKET, 'eth')).toBe(true);
    expect(isSupportedBridgeChain(BRIDGE_ENUM.SOCKET, 'base')).toBe(true);
    expect(isSupportedBridgeChain(BRIDGE_ENUM.SOCKET, 'hood')).toBe(true);
    expect(isSupportedBridgeChain(BRIDGE_ENUM.SOCKET, 'abs')).toBe(false);
    expect(isSupportedBridgeChain(BRIDGE_ENUM.SOCKET, 'era')).toBe(false);
    expect(isSupportedBridgeChain(BRIDGE_ENUM.SOCKET, 'tempo')).toBe(false);
    expect(getBridgeSpender(BRIDGE_ENUM.SOCKET, 'eth')).toBe(
      socketAllowanceHolder
    );
    expect(getBridgeRouter(BRIDGE_ENUM.SOCKET, 'HOOD')).toBe(
      socketAllowanceHolder
    );
    expect(getBridgeAltContracts(BRIDGE_ENUM.SOCKET)).toEqual([]);
  });

  test('exposes across per-chain SpokePool plus global periphery alt contracts', () => {
    const acrossEthSpokePool = '0x5c7bcd6e7de5423a257d81b442095a1a6ced35c5';
    const acrossArbSpokePool = '0xe35e9842fceaca96570b734083f4a58e8f7c5f2a';
    const acrossHoodSpokePool = '0xD29C85F15DF544bA632C9E25829fd29d767d7978';
    const periphery = '0x10d8b8daa26d307489803e10477de69c0492b610';
    const peripheryZkSync = '0x5a148a9260c1f670429361c34d40b477280f01a9';

    expect(isSupportedBridgeAggregator(BRIDGE_ENUM.ACROSS)).toBe(true);
    expect(isSupportedBridgeChain(BRIDGE_ENUM.ACROSS, 'eth')).toBe(true);
    expect(isSupportedBridgeChain(BRIDGE_ENUM.ACROSS, 'arb')).toBe(true);
    expect(isSupportedBridgeChain(BRIDGE_ENUM.ACROSS, 'hyper')).toBe(true);
    expect(isSupportedBridgeChain(BRIDGE_ENUM.ACROSS, 'hood')).toBe(true);
    expect(getBridgeSpender(BRIDGE_ENUM.ACROSS, 'eth')).toBe(acrossEthSpokePool);
    expect(getBridgeRouter(BRIDGE_ENUM.ACROSS, 'arb')).toBe(acrossArbSpokePool);
    expect(getBridgeSpender(BRIDGE_ENUM.ACROSS, 'hood')).toBe(
      acrossHoodSpokePool
    );
    expect(getBridgeRouter(BRIDGE_ENUM.ACROSS, 'HOOD')).toBe(
      acrossHoodSpokePool
    );
    // v1 and v2 periphery addresses are globally valid for across
    expect(getBridgeAltContracts(BRIDGE_ENUM.ACROSS)).toEqual([
      periphery,
      '0x97ccdbea4632140639ad5ea9b944aa034eb15fd4',
      peripheryZkSync,
      '0x7c99ced6d8011af8a52488884f7ba2c61b0fa57d',
    ]);
    // aggregators without alt contracts return an empty list
    expect(getBridgeAltContracts(BRIDGE_ENUM.LIFI)).toEqual([]);
  });

  test('exposes relay per-chain Depository plus global ApprovalProxy and Router alt contracts', () => {
    const relayEthDepository = '0x4cd00e387622c35bddb9b4c962c136462338bc31';

    expect(getBridgeRouter(BRIDGE_ENUM.RELAY, 'eth')).toBe(relayEthDepository);
    expect(isSupportedBridgeChain(BRIDGE_ENUM.RELAY, 'hood')).toBe(true);
    expect(getBridgeSpender(BRIDGE_ENUM.RELAY, 'hood')).toBe(relayEthDepository);
    expect(getBridgeRouter(BRIDGE_ENUM.RELAY, 'HOOD')).toBe(relayEthDepository);
    expect(getBridgeAltContracts(BRIDGE_ENUM.RELAY)).toEqual([
      '0x8754bc615047de01228a7527b712806a71a8dc9a',
      '0xccc88a9d1b4ed6b0eaba998850414b24f1c315be',
      '0xf6e54bbf91e564fcf0df3ed9f2dd82913e9232c3',
      '0x9ef6d3c2f60d7b9008d74cab1fc0f899c957c819',
      '0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f',
      '0xe16870b028704e38dbc254a84d3f72c8ba345ca9',
    ]);
  });
});


describe('Arc bridge allowlists', () => {
  test.each(['arc', 'ARC', 'Arc'])('normalizes %s and preserves round-tripping', (chainId) => {
    expect(normalizeChainEnum(chainId)).toBe('ARC');
    expect(SERVER_ID_TO_CHAIN_ENUM.arc).toBe('ARC');
    expect(CHAIN_ENUM_TO_SERVER_ID.ARC).toBe('arc');
  });

  test.each([
    [BRIDGE_ENUM.ACROSS, '0x9b4a302a548c7e313c2b74c461db7b84d3074a84'],
    [BRIDGE_ENUM.RELAY, '0x4cd00e387622c35bddb9b4c962c136462338bc31'],
  ])('exposes Arc support and primary contracts for %s', (aggregator, address) => {
    expect(isSupportedBridgeChain(aggregator, 'arc')).toBe(true);
    expect(BRIDGE_SUPPORT_CHAINS[aggregator]).toContain('ARC');
    expect(ALL_SUPPORTED_BRIDGE_CHAINS).toContain('ARC');
    expect(getBridgeSpender(aggregator, 'arc')).toBe(address);
    expect(getBridgeRouter(aggregator, 'ARC')).toBe(address);
  });

});
