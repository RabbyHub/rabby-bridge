import { describe, expect, jest, test } from '@jest/globals';
import {
  BRIDGE_ENUM,
  InvalidBridgeContractError,
  InvalidBridgeCalldataError,
  buildTx,
  getQuote,
  getQuoteListWithTx,
  validateBridgeQuote,
  validateBridgeCalldata,
  validateBridgeTx,
  decodeBridgeCalldata,
} from '../dist/index.js';
import { loadProviderTransactions, loadTransactions, readFixture } from './helpers/fixtures.js';
import { expectCalldataError } from './helpers/assert-validation-error.js';
import { providerHistoryResponse } from './helpers/history.js';

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
    const error = expectCalldataError(() => validateBridgeTx(BRIDGE_ENUM.LIFI, 'eth', 'bridge-1', makeTx({ data })));
    expect(error.errors[0]).toMatchObject({ pass: false, routerPass: true, fromPass: false, toPass: false, receiverPass: false });
  });

  test('rejects an unconfigured router instead of skipping transaction checks', () => {
    expect(() => validateBridgeTx(BRIDGE_ENUM.LIFI, 'not-configured', 'bridge-1', makeTx(), undefined))
      .toThrow(InvalidBridgeContractError);
  });

  test('accepts case-insensitive router matches', () => {
    const error = expectCalldataError(() => validateBridgeTx(BRIDGE_ENUM.LIFI, 'eth', 'bridge-1', makeTx()));
    expect(error.errors[0]).toMatchObject({ routerPass: true });
  });

  test('accepts socket v3 allowance holder as router', () => {
    const error = expectCalldataError(() =>
      validateBridgeTx(
        BRIDGE_ENUM.SOCKET,
        'hood',
        'bridge-1',
        { ...socketSample.tx, to: '0x50c4E75a512F2A14A7b304787Adf79C4531A5909' }, undefined
      )
    );
    expect(error.errors[0]).toMatchObject({ routerPass: true });
  });

  test('throws when tx router does not match the allowlist', () => {
    expect(() =>
      validateBridgeTx(
        BRIDGE_ENUM.LIFI,
        'eth',
        'bridge-1',
        makeTx({ to: '0xdeadbeef' }), undefined
      )
    ).toThrow(InvalidBridgeContractError);
  });

  test('checks Across pool and periphery router identities before decoding', () => {
    const baseSpokePool = '0x09aea4b2242abc8bb4bb78d537a67a245a7bec64';
    const periphery = '0x10D8b8DaA26d307489803e10477De69C0492B610';

    const poolError = expectCalldataError(() =>
      validateBridgeTx(
        BRIDGE_ENUM.ACROSS,
        'base',
        'bridge-1',
        makeTx({ to: baseSpokePool }), undefined
      )
    );
    expect(poolError.errors[0]).toMatchObject({ routerPass: true, fromPass: false });

    const peripheryError = expectCalldataError(() =>
      validateBridgeTx(
        BRIDGE_ENUM.ACROSS,
        sample.chainKey,
        'bridge-1',
        makeTx({ to: periphery }), undefined
      )
    );
    expect(peripheryError.errors[0]).toMatchObject({ routerPass: true, fromPass: false });

    // anything else is still rejected
    expect(() =>
      validateBridgeTx(
        BRIDGE_ENUM.ACROSS,
        'base',
        'bridge-1',
        makeTx({ to: '0xdeadbeef' }), undefined
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
    const onError = jest.fn();
    const sourceTx = makeTx({ from: '0x1111111111111111111111111111111111111111' });
    await expect(buildTx(BRIDGE_ENUM.LIFI, {
      ...baseParams, bridgeId: sample.bridgeId, onError,
    }, { buildBridgeTx: jest.fn().mockResolvedValue(sourceTx) })).rejects.toBeInstanceOf(InvalidBridgeCalldataError);
    expect(onError.mock.calls[0][0].errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ error_code: 'BRIDGE_FROM_ADDRESS_MISMATCH', pass: false, fromPass: false, blocking: true }),
    ]));
  });

  test('rejects a missing expected output amount when calldata exposes a minimum', async () => {
    const onError = jest.fn();
    await expect(buildTx(BRIDGE_ENUM.LIFI, {
      ...baseParams, bridgeId: sample.bridgeId, toTokenRawAmount: undefined, quoteKey: {}, onError,
    }, { buildBridgeTx: jest.fn().mockResolvedValue(makeTx()) })).rejects.toBeInstanceOf(InvalidBridgeCalldataError);
    expect(onError.mock.calls[0][0].errors[0]).toMatchObject({ unverifiedFields: ['minOutputAmount'], blocking: true });
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
    ['fromTokenId', '0x0000000000000000000000000000000000000001', 'BRIDGE_FROM_TOKEN_MISMATCH'],
    ['fromTokenRawAmount', '1', 'BRIDGE_FROM_AMOUNT_MISMATCH'],
    ['userAddress', '0x0000000000000000000000000000000000000001', 'BRIDGE_FROM_ADDRESS_MISMATCH'],
  ])('reports OFT %s checks while its output fields are deferred', async (field, value, code) => {
    const onError = jest.fn();
    await expect(buildTx(BRIDGE_ENUM.SOCKET, {
      userAddress: oftSample.tx.from, fromChainId: oftSample.chainKey,
      fromTokenId: oftSample.expected.sourceToken, fromTokenRawAmount: oftSample.expected.sourceAmount,
      toChainId: oftSample.toChainKey, toTokenId: oftSample.expected.outputToken,
      toTokenRawAmount: quotedRawAmount(oftSample).toString(), bridgeId: 'oft', slippage: '0.01',
      [field]: value, onError,
    }, { buildBridgeTx: jest.fn().mockResolvedValue(oftSample.tx) })).rejects.toBeInstanceOf(InvalidBridgeCalldataError);
    expect(onError.mock.calls.flatMap(([report]) => report.errors)).toEqual(expect.arrayContaining([
      expect.objectContaining({ error_code: code, pass: false, blocking: true }),
    ]));
  });

  test.each([
    { name: 'uses buildBridgeTx and stringifies object quote keys', method: 'buildBridgeTx',
      quoteKey: { route: 'default' }, expectedKey: '{"route":"default"}' },
    { name: 'keeps string quote keys untouched', method: 'buildBridgeTx',
      quoteKey: 'quote-key', expectedKey: 'quote-key' },
    { name: 'falls back to getBridgeQuoteTxV2', method: 'getBridgeQuoteTxV2' },
  ])('$name', async ({ method, quoteKey, expectedKey }) => {
    const builtTx = makeTx();
    const api = { [method]: jest.fn().mockResolvedValue(method === 'buildBridgeTx' ? builtTx : { tx: builtTx }) };
    const tx = await buildTx(BRIDGE_ENUM.LIFI, { ...baseParams, bridgeId: 'bridge-1', quoteKey }, api);

    expect(api[method]).toHaveBeenCalledTimes(1);
    expect(api[method]).toHaveBeenCalledWith({
      aggregator_id: BRIDGE_ENUM.LIFI,
      bridge_id: 'bridge-1',
      user_addr: baseParams.userAddress,
      from_chain_id: baseParams.fromChainId,
      from_token_id: baseParams.fromTokenId,
      from_token_raw_amount: baseParams.fromTokenRawAmount,
      to_chain_id: baseParams.toChainId,
      to_token_id: baseParams.toTokenId,
      slippage: baseParams.slippage,
      ...(expectedKey === undefined ? {} : { quote_key: expectedKey }),
    });
    expect(tx).toEqual(builtTx);
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
    const error = expectCalldataError(() => validateBridgeTx(BRIDGE_ENUM.ACROSS, 'arc', 'bridge-1', makeTx({ to: contract })));
    expect(error.errors[0]).toMatchObject({ routerPass: true, fromPass: false });
  });

  test('Relay quote lookup uses the existing backend without a provider client', async () => {
    const api = { getBridgeQuoteListV2: jest.fn(async () => []), buildBridgeTx: jest.fn() };
    await expect(getQuoteListWithTx(BRIDGE_ENUM.RELAY, { ...baseParams, fromChainId: 'arc' }, {
      ...api,
    })).resolves.toEqual([]);
    expect(api.getBridgeQuoteListV2).toHaveBeenCalledTimes(1);
    expect(api.buildBridgeTx).not.toHaveBeenCalled();
  });

  test('accepts the global router case-insensitively with a canonical chain enum', () => {
    const error = expectCalldataError(() => validateBridgeTx(
      BRIDGE_ENUM.RELAY, 'ARC', 'bridge-1', { ...relaySample.tx, chainId: 5042, to: relayRouter.toUpperCase() }, undefined
    ));
    expect(error.errors[0]).toMatchObject({ routerPass: true });
  });

  test.each([
    [BRIDGE_ENUM.ACROSS, 'arc'],
  ])('rejects the Arc Relay router for %s on %s', (aggregator, chainId) => {
    expect(() => validateBridgeTx(
      aggregator, chainId, 'bridge-1', makeTx({ to: relayRouter }), undefined
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
      aggregator, 'arc', 'bridge-1', makeTx({ to: '0xdeadbeef' }), undefined
    )).toThrow(InvalidBridgeContractError);
  });
});

describe('Elysium routes', () => {
  const depository = '0x4cd00e387622c35bddb9b4c962c136462338bc31';
  const nativeRouter = '0x0729e2a4716d9f7dd17858d5d504426d228697f7';

  test.each([
    ['elysium', 'hyper', depository, depository, '0x0'],
    ['ELYSIUM', 'hyper', undefined, nativeRouter.toUpperCase(), '0x1'],
    ['elysium', 'hyper', nativeRouter, nativeRouter, '0x1'],
    ['hyper', 'Elysium', depository, depository, '0x0'],
  ])('accepts Relay %s → %s via %s / %s', async (fromChainId, toChainId, spender, router, value) => {
    const quote = makeQuote({ approve_contract_id: spender });
    const { chainId: _ignoredChainId, ...sourceTx } = relaySample.tx;
    const tx = { ...sourceTx, to: router, value };
    const api = {
      getBridgeQuoteListV2: jest.fn().mockResolvedValue([quote]),
      buildBridgeTx: jest.fn().mockResolvedValue(tx),
    };

    await expect(getQuoteListWithTx(
      BRIDGE_ENUM.RELAY,
      {
        userAddress: relaySample.tx.from,
        fromChainId,
        fromTokenId: relaySample.expected.sourceToken,
        fromTokenRawAmount: relaySample.expected.sourceAmount,
        toChainId,
        toTokenId: relaySample.expected.outputToken,
        toTokenRawAmount: relaySample.expected.minOutputAmount,
        slippage: '0.01',
        allowMissingRelayOrder: true,
      },
      api
    )).resolves.toEqual([{ ...quote, tx }]);
    expect(api.getBridgeQuoteListV2).toHaveBeenCalledTimes(1);
    expect(api.buildBridgeTx).toHaveBeenCalledTimes(1);
  });

  test('rejects unknown Relay spender and router contracts', () => {
    expect(() => validateBridgeQuote(
      BRIDGE_ENUM.RELAY, 'elysium', makeQuote({ approve_contract_id: '0xdeadbeef' })
    )).toThrow(InvalidBridgeContractError);
    expect(() => validateBridgeTx(
      BRIDGE_ENUM.RELAY, 'elysium', 'bridge-1', makeTx({ to: '0xdeadbeef' })
    )).toThrow(InvalidBridgeContractError);
  });

});

describe('local selected-quote identifier binding', () => {
  const socket = readFixture('providers/socket/quote-v3.json');
  const relay = readFixture('providers/relay/quote-v2.json');
  const relayMulticalls = readFixture('providers/history/cases.json').filter((item) =>
    item.aggregatorId === 'relay' && item.tx.data.startsWith('0xcd6e13f7'));
  const otherId = '0x' + '12'.repeat(32);
  const key = (id) => ({ quote_id: `${id}:cache-selection` });
  const codes = (result) => result.errors.map((error) => error.error_code);
  const flags = ({ routerPass, fromPass, toPass, receiverPass }) => ({ routerPass, fromPass, toPass, receiverPass });
  const replaceId = (tx, before, after) => ({ ...tx, data: tx.data.replaceAll(before.slice(2), after.slice(2)) });
  const rfq = socket.cases.find((item) => item.bridgeId === 'rfq-vault-executor');
  const socketId = (item) => socket.response.result.routes.find((route) =>
    route.routeDetails.bridgeDetails.protocol.name === item.bridgeId).quoteId;

  test.each(socket.cases)('binds Socket $bridgeId to its separately captured provider quote ID', (item) => {
    const intent = { ...socket.params, quoteKey: key(socketId(item)) };
    expect(validateBridgeCalldata('socket', item.chainKey, item.tx, intent).errors).toEqual([]);
    const baseline = validateBridgeTx('socket', item.chainKey, item.bridgeId, item.tx, intent);
    const changed = expectCalldataError(() => validateBridgeTx('socket', item.chainKey, item.bridgeId, item.tx,
      { ...intent, quoteKey: key(otherId) }));
    expect(codes(changed)).toEqual(['BRIDGE_QUOTE_ID_MISMATCH']);
    expect(flags(changed.errors[0])).toEqual(flags(baseline));
    expect(changed.errors[0]).toMatchObject({ pass: false, routerPass: true, fromPass: true, blocking: true });
  });

  test('accepts serialized keys and case differences without comparing the cache suffix', () => {
    const quoteId = socketId(rfq);
    const intent = { ...socket.params, quoteKey: JSON.stringify({ quote_id: `${quoteId.toUpperCase()}:another-cache` }) };
    expect(validateBridgeCalldata('socket', rfq.chainKey, rfq.tx, intent).errors).toEqual([]);
  });

  test.each([undefined, {}, { quote_id: 'legacy-cache-uuid' }, 'invalid-json', '[]'])(
    'silently skips a missing or unrecognized expected ID: %j', (quoteKey) => {
      expect(validateBridgeCalldata('socket', rfq.chainKey, rfq.tx, { ...socket.params, quoteKey }).errors).toEqual([]);
    }
  );

  test('compares the RFQ outer and vault quote IDs even without a selected quote key', () => {
    const parsed = decodeBridgeCalldata('socket', rfq.tx);
    const vaultCall = '823b01f9' + parsed.orderId.slice(2);
    expect(rfq.tx.data).toContain(vaultCall);
    const changed = { ...rfq.tx, data: rfq.tx.data.replace(vaultCall, '823b01f9' + otherId.slice(2)) };
    expect(codes(validateBridgeCalldata('socket', rfq.chainKey, changed, socket.params)))
      .toEqual(['BRIDGE_SOCKET_RFQ_QUOTE_ID_MISMATCH']);
    const baseline = validateBridgeTx('socket', rfq.chainKey, rfq.bridgeId, rfq.tx, socket.params);
    const error = expectCalldataError(() => validateBridgeTx('socket', rfq.chainKey, rfq.bridgeId, changed, socket.params));
    expect(flags(error.errors[0])).toEqual(flags(baseline));
  });

  test('does not compare the Relay depository order hash with the quote request ID', () => {
    expect(relay.response.requestId).not.toBe(relay.expected.orderId);
    expect(validateBridgeCalldata('relay', relay.params.fromChainId, relay.tx,
      { ...relay.params, quoteKey: key(relay.response.requestId) }).errors).toEqual([]);
  });

  test.each(relayMulticalls)('binds Relay $id to its deposit order instead of outer metadata', async (item) => {
    const response = providerHistoryResponse(item);
    const request = response.requests.find((row) => row.data.inTxs.some((tx) =>
      tx.hash.toLowerCase() === item.txHash.toLowerCase()));
    const parsed = decodeBridgeCalldata('relay', item.tx);
    expect(request.status).toBe('success');
    expect(parsed.requestId).not.toBe(request.id);
    expect(parsed.orderId).toBe(request.protocol.orderId);
    const intent = {
      userAddress: item.tx.from, fromChainId: item.chainKey, bridgeId: 'relay',
      fromTokenId: item.expected.sourceToken, fromTokenRawAmount: item.expected.sourceAmount,
      toChainId: item.toChainKey, toTokenId: item.expected.outputToken,
      toTokenRawAmount: item.expected.expectedOutputAmount, slippage: '0.01',
      // Historical request ID in the backend cache-key format; the original quote key was not retained.
      quoteKey: key(request.id), orderData: request.orderData,
    };
    const tx = { ...item.tx, order_data: request.orderData };
    const onError = jest.fn();
    await expect(buildTx('relay', { ...intent, onError }, { buildBridgeTx: async () => tx })).resolves.toBe(tx);
    expect(onError).not.toHaveBeenCalled();
    expect(validateBridgeTx('relay', item.chainKey, 'relay', tx, intent))
      .toMatchObject({ pass: true, receiverPass: true });

    const missingData = expectCalldataError(() => validateBridgeTx('relay', item.chainKey, 'relay', tx,
      { ...intent, orderData: undefined }));
    expect(codes(missingData)).toContain('BRIDGE_MISSING_RELAY_ORDER_DATA');
    const wrongHash = expectCalldataError(() => validateBridgeTx('relay', item.chainKey, 'relay', tx,
      { ...intent, orderData: { ...request.orderData, salt: otherId } }));
    expect(codes(wrongHash)).toContain('BRIDGE_RELAY_ORDER_HASH_MISMATCH');
    const missingOrder = expectCalldataError(() => validateBridgeTx('relay', item.chainKey, 'relay',
      replaceId(tx, parsed.orderId, '0x' + '00'.repeat(32)), intent));
    expect(codes(missingOrder)).toContain('BRIDGE_MISSING_RELAY_ORDER_ID');
  });

  test('snapshots the selected key before the backend await and reports without exposing IDs', async () => {
    const quoteId = socketId(rfq);
    const quoteKey = key(quoteId);
    const tx = replaceId(rfq.tx, quoteId, otherId);
    const onError = jest.fn();
    const api = { buildBridgeTx: jest.fn(async () => {
      quoteKey.quote_id = `${otherId}:replaced-selection`;
      return tx;
    }) };
    await expect(buildTx('socket', { ...socket.params, bridgeId: rfq.bridgeId, quoteKey, onError }, api))
      .rejects.toMatchObject({ error_code: 'BRIDGE_QUOTE_ID_MISMATCH' });
    expect(api.buildBridgeTx.mock.calls[0][0].quote_key).toBe(JSON.stringify(key(quoteId)));
    expect(onError.mock.calls[0][0].errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ error_code: 'BRIDGE_QUOTE_ID_MISMATCH', blocking: true, fromPass: true }),
    ]));
    const report = JSON.stringify(onError.mock.calls);
    for (const value of [quoteId, otherId, 'cache-selection', 'replaced-selection', tx.data]) expect(report).not.toContain(value);
  });

  test('forwards quote IDs from quote-list builds and filters mismatching transactions', async () => {
    const onError = jest.fn();
    const quote = { bridge_id: rfq.bridgeId, quote_key: key(otherId) };
    const api = { getBridgeQuoteListV2: async () => [quote], buildBridgeTx: async () => rfq.tx };
    await expect(getQuoteListWithTx('socket', { ...socket.params, onError }, api)).resolves.toEqual([]);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].errors[0].error_code).toBe('BRIDGE_QUOTE_ID_MISMATCH');
  });

  test('does not bind the legacy fresh quote+tx API to an unused selection key', async () => {
    const onError = jest.fn();
    await expect(buildTx('socket', { ...socket.params, bridgeId: rfq.bridgeId, quoteKey: key(otherId), onError },
      { getBridgeQuoteTxV2: async () => ({ tx: rfq.tx }) })).resolves.toBe(rfq.tx);
    expect(onError).not.toHaveBeenCalled();
  });
});
