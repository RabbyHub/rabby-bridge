import { describe, expect, jest, test } from '@jest/globals';

import {
  BRIDGE_ENUM,
  InvalidBridgeContractError,
  buildTx,
  getQuote,
  getQuoteListWithTx,
  validateBridgeQuote,
  validateBridgeTx,
} from '../dist/index.js';

const baseParams = {
  userAddress: '0x1111111111111111111111111111111111111111',
  fromChainId: 'eth',
  fromTokenId: 'eth_token',
  fromTokenRawAmount: '1000000000000000000',
  toChainId: 'arb',
  toTokenId: 'arb_token',
  slippage: '0.5',
};

const makeQuote = (overrides = {}) => ({
  bridge_id: 'bridge-1',
  quote_key: { route: 'default' },
  approve_contract_id: '0x1231DEB6F5749EF6CE6943A275A1D3E7486F4EAE',
  ...overrides,
});

const makeTx = (overrides = {}) => ({
  to: '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae',
  data: '0x',
  value: '0x0',
  ...overrides,
});

describe('validateBridgeQuote', () => {
  test('accepts case-insensitive spender matches', () => {
    expect(
      validateBridgeQuote(BRIDGE_ENUM.LIFI, 'eth', makeQuote())
    ).toBe(true);
  });

  test('skips validation for near intents', () => {
    expect(
      validateBridgeQuote(
        BRIDGE_ENUM.NEAR_INTENTS,
        'eth',
        makeQuote({ approve_contract_id: '0xdeadbeef' })
      )
    ).toBe(true);
  });

  test('throws when quote spender does not match the allowlist', () => {
    expect(() =>
      validateBridgeQuote(
        BRIDGE_ENUM.LIFI,
        'eth',
        makeQuote({ approve_contract_id: '0xdeadbeef' })
      )
    ).toThrow(
      new InvalidBridgeContractError(
        'spender',
        BRIDGE_ENUM.LIFI,
        'eth',
        '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae',
        '0xdeadbeef',
        'bridge-1'
      )
    );
  });
});

describe('validateBridgeTx', () => {
  test('accepts case-insensitive router matches', () => {
    expect(validateBridgeTx(BRIDGE_ENUM.LIFI, 'eth', 'bridge-1', makeTx())).toBe(
      true
    );
  });

  test('throws when tx router does not match the allowlist', () => {
    expect(() =>
      validateBridgeTx(
        BRIDGE_ENUM.LIFI,
        'eth',
        'bridge-1',
        makeTx({ to: '0xdeadbeef' })
      )
    ).toThrow(InvalidBridgeContractError);
  });
});

describe('getQuote', () => {
  test('prefers getBridgeQuoteListV2 and filters invalid quotes', async () => {
    const api = {
      getBridgeQuoteListV2: jest.fn().mockResolvedValue([
        makeQuote({ bridge_id: 'valid-bridge' }),
        makeQuote({
          bridge_id: 'invalid-bridge',
          approve_contract_id: '0xdeadbeef',
        }),
      ]),
      getBridgeQuoteV2: jest.fn(),
    };

    const quotes = await getQuote(BRIDGE_ENUM.LIFI, baseParams, api);

    expect(api.getBridgeQuoteListV2).toHaveBeenCalledWith({
      aggregator_id: BRIDGE_ENUM.LIFI,
      user_addr: baseParams.userAddress,
      from_chain_id: baseParams.fromChainId,
      from_token_id: baseParams.fromTokenId,
      from_token_raw_amount: baseParams.fromTokenRawAmount,
      to_chain_id: baseParams.toChainId,
      to_token_id: baseParams.toTokenId,
    });
    expect(api.getBridgeQuoteV2).not.toHaveBeenCalled();
    expect(quotes).toEqual([makeQuote({ bridge_id: 'valid-bridge' })]);
  });

  test('falls back to getBridgeQuoteV2 and forwards slippage', async () => {
    const api = {
      getBridgeQuoteV2: jest.fn().mockResolvedValue([makeQuote()]),
    };

    const quotes = await getQuote(BRIDGE_ENUM.LIFI, baseParams, api);

    expect(api.getBridgeQuoteV2).toHaveBeenCalledWith({
      aggregator_id: BRIDGE_ENUM.LIFI,
      user_addr: baseParams.userAddress,
      from_chain_id: baseParams.fromChainId,
      from_token_id: baseParams.fromTokenId,
      from_token_raw_amount: baseParams.fromTokenRawAmount,
      to_chain_id: baseParams.toChainId,
      to_token_id: baseParams.toTokenId,
      slippage: baseParams.slippage,
    });
    expect(quotes).toEqual([makeQuote()]);
  });

  test('requires slippage when only getBridgeQuoteV2 is available', async () => {
    await expect(
      getQuote(
        BRIDGE_ENUM.LIFI,
        { ...baseParams, slippage: undefined },
        { getBridgeQuoteV2: jest.fn() }
      )
    ).rejects.toThrow('slippage is required for this API call');
  });

  test('rejects unsupported aggregators and unsupported chains', async () => {
    await expect(
      getQuote('unsupported', baseParams, { getBridgeQuoteListV2: jest.fn() })
    ).rejects.toThrow('unsupported is not supported');

    await expect(
      getQuote(BRIDGE_ENUM.STARGATE, { ...baseParams, fromChainId: 'cro' }, {
        getBridgeQuoteListV2: jest.fn(),
      })
    ).rejects.toThrow(`${BRIDGE_ENUM.STARGATE} does not support cro`);
  });

  test('errors when the bridge API exposes no quote list method', async () => {
    await expect(getQuote(BRIDGE_ENUM.LIFI, baseParams, {})).rejects.toThrow(
      'Bridge API does not provide a quote list method'
    );
  });
});

describe('buildTx', () => {
  test('uses buildBridgeTx and stringifies object quote keys', async () => {
    const api = {
      buildBridgeTx: jest.fn().mockResolvedValue(makeTx()),
    };

    const tx = await buildTx(
      BRIDGE_ENUM.LIFI,
      {
        ...baseParams,
        bridgeId: 'bridge-1',
        quoteKey: { route: 'default' },
      },
      api
    );

    expect(api.buildBridgeTx).toHaveBeenCalledWith({
      aggregator_id: BRIDGE_ENUM.LIFI,
      bridge_id: 'bridge-1',
      user_addr: baseParams.userAddress,
      from_chain_id: baseParams.fromChainId,
      from_token_id: baseParams.fromTokenId,
      from_token_raw_amount: baseParams.fromTokenRawAmount,
      to_chain_id: baseParams.toChainId,
      to_token_id: baseParams.toTokenId,
      slippage: baseParams.slippage,
      quote_key: JSON.stringify({ route: 'default' }),
    });
    expect(tx).toEqual(makeTx());
  });

  test('keeps string quote keys untouched', async () => {
    const api = {
      buildBridgeTx: jest.fn().mockResolvedValue(makeTx()),
    };

    await buildTx(
      BRIDGE_ENUM.LIFI,
      {
        ...baseParams,
        bridgeId: 'bridge-1',
        quoteKey: 'quote-key',
      },
      api
    );

    expect(api.buildBridgeTx).toHaveBeenCalledWith(
      expect.objectContaining({
        quote_key: 'quote-key',
      })
    );
  });

  test('falls back to getBridgeQuoteTxV2', async () => {
    const api = {
      getBridgeQuoteTxV2: jest.fn().mockResolvedValue({ tx: makeTx() }),
    };

    const tx = await buildTx(
      BRIDGE_ENUM.LIFI,
      {
        ...baseParams,
        bridgeId: 'bridge-1',
      },
      api
    );

    expect(api.getBridgeQuoteTxV2).toHaveBeenCalledWith({
      aggregator_id: BRIDGE_ENUM.LIFI,
      bridge_id: 'bridge-1',
      user_addr: baseParams.userAddress,
      from_chain_id: baseParams.fromChainId,
      from_token_id: baseParams.fromTokenId,
      from_token_raw_amount: baseParams.fromTokenRawAmount,
      to_chain_id: baseParams.toChainId,
      to_token_id: baseParams.toTokenId,
      slippage: baseParams.slippage,
    });
    expect(tx).toEqual(makeTx());
  });

  test('requires slippage and validates routers', async () => {
    await expect(
      buildTx(
        BRIDGE_ENUM.LIFI,
        {
          ...baseParams,
          bridgeId: 'bridge-1',
          slippage: undefined,
        },
        { buildBridgeTx: jest.fn() }
      )
    ).rejects.toThrow('slippage is required for this API call');

    await expect(
      buildTx(
        BRIDGE_ENUM.LIFI,
        {
          ...baseParams,
          bridgeId: 'bridge-1',
        },
        {
          buildBridgeTx: jest.fn().mockResolvedValue(makeTx({ to: '0xdeadbeef' })),
        }
      )
    ).rejects.toThrow(InvalidBridgeContractError);
  });

  test('errors when the bridge API exposes no tx builder', async () => {
    await expect(
      buildTx(BRIDGE_ENUM.LIFI, { ...baseParams, bridgeId: 'bridge-1' }, {})
    ).rejects.toThrow('Bridge API does not provide a build tx method');
  });
});

describe('getQuoteListWithTx', () => {
  test('attaches txs and filters quotes whose tx validation fails', async () => {
    const api = {
      getBridgeQuoteListV2: jest.fn().mockResolvedValue([
        makeQuote({ bridge_id: 'valid-bridge', quote_key: { route: 'valid' } }),
        makeQuote({
          bridge_id: 'invalid-bridge',
          quote_key: { route: 'invalid' },
        }),
      ]),
      buildBridgeTx: jest.fn().mockImplementation(({ bridge_id }) => {
        if (bridge_id === 'invalid-bridge') {
          return Promise.resolve(makeTx({ to: '0xdeadbeef' }));
        }
        return Promise.resolve(makeTx());
      }),
    };

    const quotes = await getQuoteListWithTx(BRIDGE_ENUM.LIFI, baseParams, api);

    expect(api.buildBridgeTx).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        bridge_id: 'valid-bridge',
        quote_key: JSON.stringify({ route: 'valid' }),
      })
    );
    expect(api.buildBridgeTx).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        bridge_id: 'invalid-bridge',
        quote_key: JSON.stringify({ route: 'invalid' }),
      })
    );
    expect(quotes).toEqual([
      {
        ...makeQuote({ bridge_id: 'valid-bridge', quote_key: { route: 'valid' } }),
        tx: makeTx(),
      },
    ]);
  });
});
