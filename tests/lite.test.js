import { readFileSync } from 'node:fs';
import { describe, expect, jest, test } from '@jest/globals';
import {
  BRIDGE_ERRORS, InvalidBridgeCalldataError, InvalidBridgeContractError, InvalidBridgeProviderError,
  buildTx, getQuote, getQuoteListWithTx, getBridgeRouter, validateBridgeCalldata, validateBridgeQuote, validateBridgeTx,
} from '../dist/index.js';

const user = '0x1111111111111111111111111111111111111111';
const input = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const output = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const other = '0x2222222222222222222222222222222222222222';
const params = { userAddress: user, fromChainId: 'eth', fromTokenId: input,
  fromTokenRawAmount: '10000000', toChainId: 'base', toTokenId: output,
  toTokenRawAmount: '9900000', slippage: '0', bridgeId: 'across' };
const tx = { from: user, to: getBridgeRouter('across', 'eth'), value: '0x0', chainId: 1,
  data: '0xea86bd46' + [user, user, input, output, 10000000, 9900000, 8453, 0, 1800, 0, 352, 0]
    .map((value) => BigInt(value).toString(16).padStart(64, '0')).join('') };
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/providers/${name}-20261103.json`, import.meta.url)));
const failures = (onError) => onError.mock.calls.flatMap(([report]) => report.errors);

describe('lite preserves main decisions while observing new validation', () => {
  test.each([
    [{ ...tx, data: '0xdeadbeef' }, params, BRIDGE_ERRORS.UNSUPPORTED_METHOD.error_code],
    [tx, { ...params, fromTokenRawAmount: '1' }, BRIDGE_ERRORS.FROM_AMOUNT_MISMATCH.error_code],
    [{ ...tx, from: other }, params, BRIDGE_ERRORS.FROM_ADDRESS_MISMATCH.error_code],
    [{ ...tx, value: '-1' }, params, BRIDGE_ERRORS.INVALID_TRANSACTION_VALUE.error_code],
  ])('returns the original transaction but retains error %s', async (sourceTx, intent, code) => {
    const onError = jest.fn();
    const api = { buildBridgeTx: jest.fn(async () => sourceTx) };
    await expect(buildTx('across', { ...intent, lite: true, onError }, api)).resolves.toBe(sourceTx);
    expect(api.buildBridgeTx).toHaveBeenCalledTimes(1);
    expect(api.buildBridgeTx.mock.calls[0][0]).not.toHaveProperty('lite');
    expect(failures(onError)).toEqual(expect.arrayContaining([expect.objectContaining({ error_code: code, lite: true, blocking: false })]));
    expect(validateBridgeCalldata('across', 'eth', sourceTx, intent).ok).toBe(false);
    await expect(buildTx('across', intent, api)).rejects.toBeInstanceOf(InvalidBridgeCalldataError);
    await expect(buildTx('across', { ...intent, lite: false }, api)).rejects.toBeInstanceOf(InvalidBridgeCalldataError);
  });

  test('does not filter a quote for a new calldata failure, but still filters a legacy spender failure', async () => {
    const onError = jest.fn();
    const kept = { bridge_id: 'across', quote_key: { quote_id: 'backend' }, to_token_raw_amount_hex_str: '0x970fe0' };
    const rejected = { ...kept, approve_contract_id: other };
    const sourceTx = { ...tx, data: '0xdeadbeef' };
    const api = { getBridgeQuoteListV2: async () => [kept, rejected], buildBridgeTx: jest.fn(async () => sourceTx) };
    await expect(getQuoteListWithTx('across', { ...params, lite: true, onError }, api))
      .resolves.toEqual([{ ...kept, tx: sourceTx }]);
    expect(api.buildBridgeTx).toHaveBeenCalledTimes(1);
    expect(failures(onError)).toEqual(expect.arrayContaining([
      expect.objectContaining({ error_code: BRIDGE_ERRORS.SPENDER_NOT_ALLOWED.error_code, blocking: true }),
      expect.objectContaining({ error_code: BRIDGE_ERRORS.UNSUPPORTED_METHOD.error_code, blocking: false }),
    ]));
  });

  test('retains configured router rejection and backend/parameter failures', async () => {
    await expect(buildTx('across', { ...params, lite: true }, { buildBridgeTx: async () => ({ ...tx, to: other }) }))
      .rejects.toBeInstanceOf(InvalidBridgeContractError);
    await expect(buildTx('across', { ...params, lite: true }, { buildBridgeTx: async () => { throw new Error('network'); } }))
      .rejects.toMatchObject({ error_code: BRIDGE_ERRORS.BACKEND_BUILD_REQUEST_FAILED.error_code });
    await expect(buildTx('across', { ...params, lite: true, slippage: undefined }, {}))
      .rejects.toMatchObject({ error_code: BRIDGE_ERRORS.SLIPPAGE_IS_REQUIRED_FOR_THIS_API_CALL.error_code });
    await expect(getQuote('unsupported', { ...params, lite: true }, {}))
      .rejects.toMatchObject({ error_code: BRIDGE_ERRORS.UNSUPPORTED_BRIDGE_AGGREGATOR.error_code });
  });

  test('missing whitelist configuration remains non-blocking as on main, but is reported', () => {
    const onError = jest.fn();
    const quote = { bridge_id: 'across', approve_contract_id: other };
    expect(validateBridgeQuote('lifi', 'not-configured', quote, { lite: true, onError })).toBe(true);
    expect(() => validateBridgeQuote('lifi', 'not-configured', quote)).toThrow(InvalidBridgeContractError);
    expect(validateBridgeTx('lifi', 'not-configured', 'across', { ...tx, to: other }, params, { lite: true, onError })).toBe(true);
    expect(failures(onError).map((error) => error.error_code)).toContain(BRIDGE_ERRORS.ROUTER_NOT_ALLOWED.error_code);
    expect(failures(onError).map((error) => error.error_code)).toContain(BRIDGE_ERRORS.FROM_CHAIN_MISMATCH.error_code);
  });

  test('reports aggregators without a parser instead of silently counting them as covered', () => {
    const onError = jest.fn();
    expect(validateBridgeTx('near_intents', 'eth', 'near_intents', { ...tx, data: '0xdeadbeef' }, params, { lite: true, onError })).toBe(true);
    expect(failures(onError)).toEqual(expect.arrayContaining([
      expect.objectContaining({ error_code: BRIDGE_ERRORS.UNSUPPORTED_CALLDATA_AGGREGATOR.error_code, blocking: false }),
    ]));
  });

  test.each(['relay', 'socket'])('%s uses backend results, never replaces them with an unrelated provider quote', async (provider) => {
    const data = fixture(provider === 'relay' ? 'relay-v2' : 'socket-v3');
    const sourceTx = provider === 'relay' ? data.tx : data.cases[0].tx;
    const bridgeId = provider === 'relay' ? 'relay' : data.cases[0].bridgeId;
    const quote = { bridge_id: bridgeId, quote_key: { quote_id: 'backend-selection' }, to_token_raw_amount_hex_str: '0x100' };
    const providerClient = {
      captureContext: () => () => {},
      getQuotes: jest.fn(), buildTx: jest.fn(),
      verifyTx: jest.fn(() => { throw new InvalidBridgeProviderError(provider, BRIDGE_ERRORS.A_DIRECT_PROVIDER_QUOTE_IS_REQUIRED); }),
    };
    const onError = jest.fn();
    const api = { getBridgeQuoteListV2: jest.fn(async () => [quote]), buildBridgeTx: jest.fn(async () => sourceTx) };
    await expect(getQuoteListWithTx(provider, { ...data.params, lite: true, providerClient, onError }, api))
      .resolves.toEqual([{ ...quote, tx: sourceTx }]);
    expect(providerClient.getQuotes).not.toHaveBeenCalled();
    expect(providerClient.buildTx).not.toHaveBeenCalled();
    expect(providerClient.verifyTx).toHaveBeenCalledWith(provider, expect.objectContaining({ quoteKey: quote.quote_key }), sourceTx);
    expect(failures(onError)).toEqual(expect.arrayContaining([
      expect.objectContaining({ error_code: BRIDGE_ERRORS.A_DIRECT_PROVIDER_QUOTE_IS_REQUIRED.error_code, lite: true, blocking: false }),
    ]));
  });

  test('LayerSwap verification runs in the background and keeps its original error code', async () => {
    const data = fixture('layerswap-pending');
    let reject;
    const verification = new Promise((resolve, fail) => { reject = fail; });
    const providerClient = { captureContext: () => () => {}, verifyLayerSwapTx: jest.fn(() => verification) };
    const onError = jest.fn();
    const inputParams = { userAddress: data.tx.from, fromChainId: 'eth', fromTokenId: data.expected.sourceToken,
      fromTokenRawAmount: data.expected.sourceAmount, toChainId: 'arb', toTokenId: data.expected.outputToken,
      toTokenRawAmount: data.expected.expectedOutputAmount, slippage: '0.01', bridgeId: 'layerswap',
      lite: true, providerClient, onError };
    await expect(buildTx('lifi', inputParams, { buildBridgeTx: async () => data.tx })).resolves.toBe(data.tx);
    expect(providerClient.verifyLayerSwapTx).toHaveBeenCalledTimes(1);
    reject(new InvalidBridgeProviderError('layerswap', BRIDGE_ERRORS.REQUEST_TIMED_OUT));
    await verification.catch(() => {});
    await Promise.resolve();
    expect(failures(onError)).toEqual(expect.arrayContaining([
      expect.objectContaining({ error_code: BRIDGE_ERRORS.REQUEST_TIMED_OUT.error_code, blocking: false, lite: true }),
    ]));
  });

  test('missing clients, context invalidation and throwing reporters do not veto a lite result', async () => {
    const data = fixture('relay-v2');
    const onError = jest.fn();
    await expect(buildTx('relay', { ...data.params, bridgeId: 'relay', lite: true, onError }, { buildBridgeTx: async () => data.tx }))
      .resolves.toBe(data.tx);
    expect(failures(onError).map((error) => error.error_code)).toContain(BRIDGE_ERRORS.DIRECT_PROVIDER_CLIENT_IS_REQUIRED.error_code);
    const providerClient = { captureContext: () => () => { throw new InvalidBridgeProviderError('context', BRIDGE_ERRORS.PROVIDER_CLIENT_CONTEXT_CHANGED); } };
    await expect(buildTx('across', { ...params, lite: true, providerClient, onError: () => { throw new Error('reporter'); } },
      { buildBridgeTx: async () => ({ ...tx, data: '0xdeadbeef' }) })).resolves.toMatchObject({ data: '0xdeadbeef' });
  });
});
