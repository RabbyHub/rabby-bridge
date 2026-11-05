import { readFileSync } from 'node:fs';
import { describe, expect, jest, test } from '@jest/globals';
import {
  BRIDGE_ERRORS, InvalidBridgeContractError, toBridgeErrorReport,
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

describe('local validation observes fields while only the router blocks', () => {
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
    for (const lite of [undefined, false]) {
      const onError = jest.fn();
      await expect(buildTx('across', { ...intent, lite, onError }, api)).resolves.toBe(sourceTx);
      expect(failures(onError)).toEqual(expect.arrayContaining([
        expect.objectContaining({ error_code: code, pass: true, routerPass: true, lite: false, blocking: false }),
      ]));
    }
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

  test('lite retains the missing-spender rollout but never skips a missing router', () => {
    const onError = jest.fn();
    const quote = { bridge_id: 'across', approve_contract_id: other };
    expect(validateBridgeQuote('lifi', 'not-configured', quote, { lite: true, onError })).toBe(true);
    expect(() => validateBridgeQuote('lifi', 'not-configured', quote)).toThrow(InvalidBridgeContractError);
    expect(() => validateBridgeTx('lifi', 'not-configured', 'across', { ...tx, to: other }, params, { lite: true, onError }))
      .toThrow(InvalidBridgeContractError);
  });

  test('reports aggregators without a parser instead of silently counting them as covered', () => {
    const onError = jest.fn();
    expect(validateBridgeTx('near_intents', 'eth', 'near_intents', { ...tx, data: '0xdeadbeef' }, params, { onError }))
      .toMatchObject({ pass: true, routerPass: true, fromPass: false, toPass: false, receiverPass: false });
    expect(failures(onError)).toEqual(expect.arrayContaining([
      expect.objectContaining({ error_code: BRIDGE_ERRORS.UNSUPPORTED_CALLDATA_AGGREGATOR.error_code, blocking: false }),
    ]));
  });

  test('returns independent field results and emits no observation for a fully verified transaction', () => {
    const onError = jest.fn();
    const result = validateBridgeTx('across', 'eth', 'across', tx, params, { onError });
    expect(result).toEqual({ pass: true, routerPass: true, fromPass: true, toPass: true,
      receiverPass: true, errors: [], unverifiedFields: [] });
    expect(onError).not.toHaveBeenCalled();
    expect(toBridgeErrorReport(result)).toBeUndefined();
  });

  test.each([
    [{ fromTokenId: other }, {}, { fromPass: false, toPass: true, receiverPass: true }, BRIDGE_ERRORS.FROM_TOKEN_MISMATCH.error_code],
    [{ fromTokenRawAmount: '1' }, {}, { fromPass: false, toPass: true, receiverPass: true }, BRIDGE_ERRORS.FROM_AMOUNT_MISMATCH.error_code],
    [{ toTokenId: other }, {}, { fromPass: true, toPass: false, receiverPass: true }, BRIDGE_ERRORS.TO_TOKEN_MISMATCH.error_code],
    [{ toTokenRawAmount: '1' }, {}, { fromPass: true, toPass: false, receiverPass: true }, BRIDGE_ERRORS.MIN_RECEIVE_MISMATCH.error_code],
    [{ toChainId: 'arb' }, {}, { fromPass: true, toPass: false, receiverPass: true }, BRIDGE_ERRORS.TO_CHAIN_MISMATCH.error_code],
    [{}, { from: other }, { fromPass: false, toPass: true, receiverPass: true }, BRIDGE_ERRORS.FROM_ADDRESS_MISMATCH.error_code],
    [{}, { chainId: 10 }, { fromPass: false, toPass: true, receiverPass: true }, BRIDGE_ERRORS.FROM_CHAIN_MISMATCH.error_code],
    [{}, { data: tx.data.slice(0, 74) + BigInt(other).toString(16).padStart(64, '0') + tx.data.slice(138) },
      { fromPass: true, toPass: true, receiverPass: false }, BRIDGE_ERRORS.RECEIVER_MISMATCH.error_code],
  ])('keeps independent results for field mismatch %#', (intent, changes, flags, code) => {
    const onError = jest.fn();
    const result = validateBridgeTx('across', 'eth', 'across', { ...tx, ...changes }, { ...params, ...intent }, { onError });
    expect(result).toMatchObject({ pass: true, routerPass: true, ...flags });
    expect(failures(onError)).toEqual(expect.arrayContaining([
      expect.objectContaining({ error_code: code, ...flags, pass: true, blocking: false }),
    ]));
    expect(toBridgeErrorReport(result).error_code).toBe(code);
  });

  test('does not count a skipped minimum comparison as a verified destination', () => {
    const result = validateBridgeTx('across', 'eth', 'across', tx, { ...params, toTokenRawAmount: undefined });
    expect(result).toMatchObject({ pass: true, fromPass: true, toPass: false, receiverPass: true,
      unverifiedFields: ['minOutputAmount'] });
  });

  test('reports an unknown destination path without losing its verified source', () => {
    const data = JSON.parse(readFileSync(new URL('./fixtures/route-discovery-20261104/cases.json', import.meta.url)))
      .find((item) => item.id === 'discovery-across-destination-dex-5pct');
    const sourceTx = { ...data.tx, data: data.tx.data.replace('38c9c147', 'deadbeef') };
    const onError = jest.fn();
    const result = validateBridgeTx('across', data.chainKey, data.bridgeId, sourceTx,
      { ...data.request, toTokenRawAmount: data.quoteBenchmark.quotedOutputAmount }, { onError });
    expect(result).toMatchObject({ pass: true, routerPass: true, fromPass: true, toPass: false, receiverPass: false });
    expect(result.unverifiedFields).toEqual(expect.arrayContaining(['outputToken', 'minOutputAmount', 'receiver']));
    expect(failures(onError)).toEqual(expect.arrayContaining([
      expect.objectContaining({ error_code: BRIDGE_ERRORS.UNSUPPORTED_DESTINATION_CALL.error_code,
        method: 'deposit', hasDestinationCall: true, blocking: false }),
    ]));
    const report = JSON.stringify(failures(onError));
    expect(report).not.toContain(data.request.userAddress);
    expect(report).not.toContain(sourceTx.data);
  });

  test('router rejection retains its blocking result in the sanitized error', () => {
    try {
      validateBridgeTx('across', 'eth', 'across', { ...tx, to: other }, params);
      throw new Error('expected router rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidBridgeContractError);
      expect(error.toJSON().errors[0]).toMatchObject({ pass: false, routerPass: false, blocking: true });
    }
  });

  test.each(['relay', 'socket'])('%s uses backend results without touching a legacy provider client', async (provider) => {
    const data = fixture(provider === 'relay' ? 'relay-v2' : 'socket-v3');
    const sourceTx = provider === 'relay' ? data.tx : data.cases[0].tx;
    const bridgeId = provider === 'relay' ? 'relay' : data.cases[0].bridgeId;
    const quote = { bridge_id: bridgeId, quote_key: { quote_id: 'backend-selection' }, to_token_raw_amount_hex_str: '0x100' };
    const providerClient = { captureContext: jest.fn(), getQuotes: jest.fn(), buildTx: jest.fn(), verifyTx: jest.fn() };
    const onError = jest.fn();
    const api = { getBridgeQuoteListV2: jest.fn(async () => [quote]), buildBridgeTx: jest.fn(async () => sourceTx) };
    await expect(getQuoteListWithTx(provider, { ...data.params, lite: true, providerClient, onError }, api))
      .resolves.toEqual([{ ...quote, tx: sourceTx }]);
    for (const fn of Object.values(providerClient)) expect(fn).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    const check = validateBridgeTx(provider, data.params.fromChainId, bridgeId, sourceTx, data.params, { onError });
    expect(check).toMatchObject({ pass: true, fromPass: true, toPass: false, receiverPass: false, errors: [] });
    expect(check.unverifiedFields).toContain('receiver');
    expect(toBridgeErrorReport(check)).toBeUndefined();
    expect(onError).not.toHaveBeenCalled();
  });

  test.each([true, false])('LayerSwap performs no lookup with lite=%s', async (lite) => {
    const data = fixture('layerswap-pending');
    const providerClient = { captureContext: jest.fn(), verifyLayerSwapTx: jest.fn() };
    const onError = jest.fn();
    const intent = { userAddress: data.tx.from, fromChainId: 'eth', fromTokenId: data.expected.sourceToken,
      fromTokenRawAmount: data.expected.sourceAmount, toChainId: 'arb', toTokenId: data.expected.outputToken,
      slippage: '0.01', bridgeId: 'layerswap', lite, providerClient, onError };
    await expect(buildTx('lifi', intent, { buildBridgeTx: async () => data.tx })).resolves.toBe(data.tx);
    expect(providerClient.captureContext).not.toHaveBeenCalled();
    expect(providerClient.verifyLayerSwapTx).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    const check = validateBridgeTx('lifi', 'eth', 'layerswap', data.tx, intent);
    expect(check).toMatchObject({ pass: true, fromPass: true, toPass: false, receiverPass: true,
      unverifiedFields: ['outputToken', 'minOutputAmount'], errors: [] });
  });

  test('throwing reporters cannot veto skipped checks or a lite parse failure', async () => {
    const data = fixture('relay-v2');
    const onError = () => { throw new Error('reporter'); };
    await expect(buildTx('relay', { ...data.params, bridgeId: 'relay', onError }, { buildBridgeTx: async () => data.tx }))
      .resolves.toBe(data.tx);
    await expect(buildTx('across', { ...params, lite: true, onError },
      { buildBridgeTx: async () => ({ ...tx, data: '0xdeadbeef' }) })).resolves.toMatchObject({ data: '0xdeadbeef' });
  });
});
