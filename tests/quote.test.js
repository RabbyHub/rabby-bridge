import { describe, expect, jest, test } from '@jest/globals';

import {
  BRIDGE_ENUM,
  InvalidBridgeContractError,
  InvalidBridgeCalldataError,
  InvalidBridgeProviderError,
  buildTx,
  getQuote,
  getQuoteListWithTx,
  validateBridgeQuote,
  validateBridgeCalldata,
  validateBridgeTx,
} from '../dist/index.js';
import { loadProviderTransactions, loadTransactions } from './calldata/load-transactions.js';

// API wiring uses real calldata; parsing expectations are covered in tests/calldata.
const sample = loadTransactions('lifi')[0];
const socketSample = loadTransactions('socket')[0];
const relaySample = loadProviderTransactions().find((item) => item.aggregatorId === 'relay');
const oftSample = loadTransactions('socket').find((item) => item.bridgeId === 'oft');

const quotedRawAmount = (item) => {
  const [whole, fraction = ''] = item.quote.quote.receive_token_amount.split('.');
  return BigInt(whole + fraction.padEnd(item.quote.to_token.decimals, '0'));
};

const baseParams = {
  userAddress: sample.tx.from,
  fromChainId: sample.chainKey,
  fromTokenId: sample.quote.from_token.id,
  fromTokenRawAmount: sample.expected.sourceAmount,
  toChainId: sample.toChainKey,
  toTokenId: sample.quote.to_token.id,
  toTokenRawAmount: quotedRawAmount(sample).toString(),
  slippage: '0.01',
};

const makeQuote = (overrides = {}) => ({
  bridge_id: 'bridge-1',
  quote_key: { route: 'default' },
  to_token_raw_amount_hex_str: `0x${quotedRawAmount(sample).toString(16)}`,
  approve_contract_id: '0x1231DEB6F5749EF6CE6943A275A1D3E7486F4EAE',
  ...overrides,
});

const makeTx = (overrides = {}) => ({
  ...sample.tx,
  ...overrides,
});

describe('validateBridgeQuote', () => {
  test('rejects an approval address when the chain has no spender configuration', () => {
    expect(() => validateBridgeQuote(BRIDGE_ENUM.LIFI, 'not-configured', makeQuote()))
      .toThrow(InvalidBridgeContractError);
    expect(validateBridgeQuote(BRIDGE_ENUM.LIFI, 'not-configured', makeQuote({ approve_contract_id: undefined })))
      .toBe(true);
  });

  test('accepts case-insensitive spender matches', () => {
    expect(
      validateBridgeQuote(BRIDGE_ENUM.LIFI, 'eth', makeQuote())
    ).toBe(true);
  });

  test('accepts socket v3 allowance holder as spender', () => {
    expect(
      validateBridgeQuote(
        BRIDGE_ENUM.SOCKET,
        'hood',
        makeQuote({
          approve_contract_id: '0x50c4E75a512F2A14A7b304787Adf79C4531A5909',
        })
      )
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
  test.each(['0x', '0x12', 'not-hex'])('rejects missing or malformed calldata: %s', (data) => {
    expect(() => validateBridgeTx(BRIDGE_ENUM.LIFI, 'eth', 'bridge-1', makeTx({ data })))
      .toThrow(InvalidBridgeCalldataError);
  });

  test('rejects an unconfigured router instead of skipping transaction checks', () => {
    expect(() => validateBridgeTx(BRIDGE_ENUM.LIFI, 'not-configured', 'bridge-1', makeTx()))
      .toThrow(InvalidBridgeContractError);
  });

  test('accepts case-insensitive router matches', () => {
    expect(validateBridgeTx(BRIDGE_ENUM.LIFI, 'eth', 'bridge-1', makeTx())).toBe(
      true
    );
  });

  test('accepts socket v3 allowance holder as router', () => {
    expect(
      validateBridgeTx(
        BRIDGE_ENUM.SOCKET,
        'hood',
        'bridge-1',
        { ...socketSample.tx, to: '0x50c4E75a512F2A14A7b304787Adf79C4531A5909' }
      )
    ).toBe(true);
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

  test('checks Across pool and periphery router identities before decoding', () => {
    const baseSpokePool = '0x09aea4b2242abc8bb4bb78d537a67a245a7bec64';
    const periphery = '0x10D8b8DaA26d307489803e10477De69C0492B610';

    expect(() =>
      validateBridgeTx(
        BRIDGE_ENUM.ACROSS,
        'base',
        'bridge-1',
        makeTx({ to: baseSpokePool })
      )
    ).toThrow(InvalidBridgeCalldataError);

    expect(() =>
      validateBridgeTx(
        BRIDGE_ENUM.ACROSS,
        sample.chainKey,
        'bridge-1',
        makeTx({ to: periphery })
      )
    ).toThrow(InvalidBridgeCalldataError);

    // anything else is still rejected
    expect(() =>
      validateBridgeTx(
        BRIDGE_ENUM.ACROSS,
        'base',
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
      slippage: baseParams.slippage,
      fee_rate: undefined,
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
  test('reads an exact expected amount from a serialized quote key', async () => {
    await expect(buildTx(BRIDGE_ENUM.LIFI, {
      ...baseParams, bridgeId: sample.bridgeId, toTokenRawAmount: undefined,
      quoteKey: JSON.stringify({ to_token_raw_amount: baseParams.toTokenRawAmount }),
    }, { buildBridgeTx: jest.fn().mockResolvedValue(makeTx()) })).resolves.toEqual(makeTx());
  });

  test('rejects a source sender that differs from the local wallet', async () => {
    await expect(buildTx(BRIDGE_ENUM.LIFI, {
      ...baseParams, bridgeId: sample.bridgeId,
    }, { buildBridgeTx: jest.fn().mockResolvedValue(makeTx({ from: '0x1111111111111111111111111111111111111111' })) }))
      .rejects.toThrow('from_address');
  });

  test('rejects a missing expected output amount instead of skipping that comparison', async () => {
    await expect(buildTx(BRIDGE_ENUM.LIFI, {
      ...baseParams, bridgeId: sample.bridgeId, toTokenRawAmount: undefined, quoteKey: {},
    }, { buildBridgeTx: jest.fn().mockResolvedValue(makeTx()) })).rejects.toThrow('unverified bridge fields: minOutputAmount');
  });

  test('builds OFT while reporting its deferred destination token and amount', async () => {
    const params = {
      userAddress: oftSample.tx.from, fromChainId: oftSample.chainKey,
      fromTokenId: oftSample.expected.sourceToken, fromTokenRawAmount: oftSample.expected.sourceAmount,
      toChainId: oftSample.toChainKey, toTokenId: '0x0000000000000000000000000000000000000001',
      toTokenRawAmount: '1', bridgeId: 'oft', slippage: '0.01',
    };
    const check = validateBridgeCalldata('socket', params.fromChainId, oftSample.tx, params);
    expect(check.ok).toBe(true);
    expect(check.unverifiedFields).toEqual(['outputToken', 'minOutputAmount']);
    expect(check.parsed.outputToken).toBeUndefined();
    expect(check.parsed.minOutputAmount).toBeUndefined();
    const api = { buildBridgeTx: jest.fn().mockResolvedValue(oftSample.tx) };
    await expect(buildTx(BRIDGE_ENUM.SOCKET, params, api)).resolves.toEqual(oftSample.tx);
    expect(api.buildBridgeTx).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['fromTokenId', '0x0000000000000000000000000000000000000001', 'from_token'],
    ['fromTokenRawAmount', '1', 'from_amount'],
    ['userAddress', '0x0000000000000000000000000000000000000001', 'from_address'],
    ['toChainId', 'not-a-chain', 'destinationChainId'],
  ])('keeps OFT %s checks while its output fields are deferred', async (field, value, reason) => {
    await expect(buildTx(BRIDGE_ENUM.SOCKET, {
      userAddress: oftSample.tx.from, fromChainId: oftSample.chainKey,
      fromTokenId: oftSample.expected.sourceToken, fromTokenRawAmount: oftSample.expected.sourceAmount,
      toChainId: oftSample.toChainKey, toTokenId: oftSample.expected.outputToken,
      toTokenRawAmount: quotedRawAmount(oftSample).toString(), bridgeId: 'oft', slippage: '0.01',
      [field]: value,
    }, { buildBridgeTx: jest.fn().mockResolvedValue(oftSample.tx) })).rejects.toThrow(reason);
  });

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


describe('Arc contract validation', () => {
  const relayRouter = '0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f';

  test('accepts the configured Across contracts before checking calldata', () => {
    const contract = '0x9b4A302A548c7e313c2b74C461db7b84d3074A84';
    expect(validateBridgeQuote(BRIDGE_ENUM.ACROSS, 'arc', makeQuote({ approve_contract_id: contract }))).toBe(true);
    expect(() => validateBridgeTx(BRIDGE_ENUM.ACROSS, 'arc', 'bridge-1', makeTx({ to: contract })))
      .toThrow(InvalidBridgeCalldataError);
  });

  test('requires a direct provider quote for Relay despite an allowed router', async () => {
    await expect(getQuoteListWithTx(BRIDGE_ENUM.RELAY, { ...baseParams, fromChainId: 'arc' }, {
      getBridgeQuoteListV2: jest.fn(), buildBridgeTx: jest.fn(),
    })).rejects.toThrow(InvalidBridgeProviderError);
  });

  test('accepts the global router case-insensitively with a canonical chain enum', () => {
    expect(validateBridgeTx(
      BRIDGE_ENUM.RELAY, 'ARC', 'bridge-1', { ...relaySample.tx, chainId: 5042, to: relayRouter.toUpperCase() }
    )).toBe(true);
  });

  test.each([
    [BRIDGE_ENUM.ACROSS, 'arc'],
  ])('rejects the Arc Relay router for %s on %s', (aggregator, chainId) => {
    expect(() => validateBridgeTx(
      aggregator, chainId, 'bridge-1', makeTx({ to: relayRouter })
    )).toThrow(InvalidBridgeContractError);
  });

  test('accepts the global router as a quote contract', () => {
    expect(validateBridgeQuote(
      BRIDGE_ENUM.RELAY, 'arc', makeQuote({ approve_contract_id: relayRouter })
    )).toBe(true);
  });

  test.each([BRIDGE_ENUM.ACROSS, BRIDGE_ENUM.RELAY])('rejects unknown Arc contracts for %s', (aggregator) => {
    expect(() => validateBridgeQuote(
      aggregator, 'arc', makeQuote({ approve_contract_id: '0xdeadbeef' })
    )).toThrow(InvalidBridgeContractError);
    expect(() => validateBridgeTx(
      aggregator, 'arc', 'bridge-1', makeTx({ to: '0xdeadbeef' })
    )).toThrow(InvalidBridgeContractError);
  });
});
