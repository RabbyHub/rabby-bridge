import { readFixture } from './helpers/fixtures.js';
import { describe, expect, jest, test } from '@jest/globals';
import {
  BRIDGE_ERRORS, InvalidBridgeContractError, InvalidBridgeCalldataError, toBridgeErrorReport,
  buildTx, getQuote, getQuoteListWithTx, getBridgeRouter, validateBridgeCalldata, validateBridgeQuote, validateBridgeTx,
} from '../dist/index.js';
import { expectCalldataError } from './helpers/assert-validation-error.js';

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
const failures = (onError) => onError.mock.calls.flatMap(([report]) => report.errors);

describe('transaction validation always enforces required checks', () => {
  test.each([
    ['smaller than requested', 5000000, true],
    ['equal to requested', 10000000, true],
    ['exactly 0.1% above requested', 10010000, true],
    ['one raw unit above the cap', 10010001, false],
  ])('source amount %s obeys the spending cap', async (_, amount, accepted) => {
    const sourceTx = { ...tx, data: tx.data.slice(0, 266) +
      BigInt(amount).toString(16).padStart(64, '0') + tx.data.slice(330) };
    const onError = jest.fn();
    const built = buildTx('across', { ...params, onError }, { buildBridgeTx: async () => sourceTx });
    if (accepted) {
      await expect(built).resolves.toBe(sourceTx);
      expect(validateBridgeTx('across', 'eth', 'across', sourceTx, params).fromPass).toBe(true);
      expect(onError).not.toHaveBeenCalled();
    } else {
      await expect(built).rejects.toMatchObject({ error_code: 'BRIDGE_FROM_AMOUNT_MISMATCH' });
      expect(failures(onError)).toEqual(expect.arrayContaining([
        expect.objectContaining({ error_code: 'BRIDGE_FROM_AMOUNT_MISMATCH', fromPass: false, blocking: true }),
      ]));
    }
  });

  test('accepts the Mayan eight-decimal source truncation', () => {
    const item = readFixture('onchain/mayan/FASTMCTP.json').find((item) => item.id === 'coverage-mayan-2cef5bff8159af71cdea8812706eda55ebf57cd57f98f6ebb190bd816783e386');
    expect(validateBridgeTx('mayan', item.chainKey, item.bridgeId, item.tx, {
      userAddress: item.tx.from, fromTokenId: item.quote.from_token.id,
      fromTokenRawAmount: '23974181697083003', toChainId: item.toChainKey,
      toTokenId: item.expected.outputToken, toTokenRawAmount: item.expected.minOutputAmount, slippage: '0',
    })).toMatchObject({ pass: true, fromPass: true, errors: [] });
  });

  test.each([
    [94049999, false], [94050000, true], [99000000, true],
    [103950000, true], [103950001, true], [200000000, true],
  ])('receive minimum %s keeps the 5%% floor without an upper cap', async (minimum, accepted) => {
    const sourceTx = { ...tx, data: tx.data.slice(0, 330) +
      BigInt(minimum).toString(16).padStart(64, '0') + tx.data.slice(394) };
    const onError = jest.fn();
    const expected = { ...params, toTokenRawAmount: '100000000', slippage: '0.01', onError };
    const built = buildTx('across', expected, { buildBridgeTx: async () => sourceTx });
    if (accepted) {
      await expect(built).resolves.toBe(sourceTx);
      expect(validateBridgeTx('across', 'eth', 'across', sourceTx, expected).toPass).toBe(true);
      expect(onError).not.toHaveBeenCalled();
    } else {
      await expect(built).rejects.toMatchObject({ error_code: 'BRIDGE_MIN_RECEIVE_MISMATCH' });
      expect(failures(onError)).toEqual(expect.arrayContaining([
        expect.objectContaining({ error_code: 'BRIDGE_MIN_RECEIVE_MISMATCH', toPass: false, blocking: true }),
      ]));
    }
  });

  test.each([
    [{ ...tx, data: '0xdeadbeef' }, params, BRIDGE_ERRORS.UNSUPPORTED_METHOD.error_code],
    [tx, { ...params, fromTokenRawAmount: '1' }, BRIDGE_ERRORS.FROM_AMOUNT_MISMATCH.error_code],
    [{ ...tx, from: other }, params, BRIDGE_ERRORS.FROM_ADDRESS_MISMATCH.error_code],
    [{ ...tx, value: '-1' }, params, BRIDGE_ERRORS.INVALID_TRANSACTION_VALUE.error_code],
  ])('rejects invalid calldata and reports it once: %#', async (sourceTx, intent, code) => {
    const onError = jest.fn();
    const api = { buildBridgeTx: jest.fn(async () => sourceTx) };
    await expect(buildTx('across', { ...intent, onError }, api)).rejects.toBeInstanceOf(InvalidBridgeCalldataError);
    expect(api.buildBridgeTx).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(failures(onError)).toEqual(expect.arrayContaining([
      expect.objectContaining({ error_code: code, pass: false, routerPass: true, blocking: true }),
    ]));
    expect(validateBridgeCalldata('across', 'eth', sourceTx, intent).ok).toBe(false);
  });

  test('rejects a receiver mismatch even without a reporter', async () => {
    const sourceTx = { ...tx, data: tx.data.slice(0, 74) + BigInt(other).toString(16).padStart(64, '0') + tx.data.slice(138) };
    expect(() => validateBridgeTx('across', 'eth', 'across', sourceTx, params))
      .toThrow(InvalidBridgeCalldataError);
    await expect(buildTx('across', params, { buildBridgeTx: async () => sourceTx }))
      .rejects.toMatchObject({ errors: expect.arrayContaining([
        expect.objectContaining({ error_code: 'BRIDGE_RECEIVER_MISMATCH', pass: false, blocking: true }),
      ]) });
  });

  test('a legacy lite flag cannot bypass validation or appear in reports', async () => {
    const onError = jest.fn();
    const options = { lite: true, onError };
    const invalid = { ...tx, data: '0xdeadbeef' };
    expectCalldataError(() => validateBridgeTx('across', 'eth', 'across', invalid, params, options));
    await expect(buildTx('across', { ...params, ...options }, { buildBridgeTx: async () => invalid }))
      .rejects.toBeInstanceOf(InvalidBridgeCalldataError);
    expect(() => validateBridgeQuote('lifi', 'not-configured', { approve_contract_id: other }, options))
      .toThrow(InvalidBridgeContractError);
    for (const error of failures(onError)) expect(error).not.toHaveProperty('lite');
  });

  test('filters strict calldata failures and reports each transaction only once', async () => {
    const onError = jest.fn();
    const quote = { bridge_id: 'across', quote_key: {}, to_token_raw_amount_hex_str: '0x970fe0' };
    const api = { getBridgeQuoteListV2: async () => [quote], buildBridgeTx: async () => ({ ...tx, data: '0xdeadbeef' }) };
    await expect(getQuoteListWithTx('across', { ...params, onError }, api)).resolves.toEqual([]);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(failures(onError)[0]).toMatchObject({ pass: false, blocking: true });
  });

  test('reporter failures cannot bypass strict rejection', async () => {
    await expect(buildTx('across', { ...params, onError: () => { throw new Error('reporter'); } },
      { buildBridgeTx: async () => ({ ...tx, data: '0xdeadbeef' }) })).rejects.toBeInstanceOf(InvalidBridgeCalldataError);
  });

  test('filters both calldata and spender failures', async () => {
    const onError = jest.fn();
    const kept = { bridge_id: 'across', quote_key: { quote_id: 'backend' }, to_token_raw_amount_hex_str: '0x970fe0' };
    const rejected = { ...kept, approve_contract_id: other };
    const sourceTx = { ...tx, data: '0xdeadbeef' };
    const api = { getBridgeQuoteListV2: async () => [kept, rejected], buildBridgeTx: jest.fn(async () => sourceTx) };
    await expect(getQuoteListWithTx('across', { ...params, onError }, api))
      .resolves.toEqual([]);
    expect(api.buildBridgeTx).toHaveBeenCalledTimes(1);
    expect(failures(onError)).toEqual(expect.arrayContaining([
      expect.objectContaining({ error_code: BRIDGE_ERRORS.SPENDER_NOT_ALLOWED.error_code }),
      expect.objectContaining({ error_code: BRIDGE_ERRORS.UNSUPPORTED_METHOD.error_code, blocking: true }),
    ]));
  });

  test('retains configured router rejection and backend/parameter failures', async () => {
    await expect(buildTx('across', { ...params }, { buildBridgeTx: async () => ({ ...tx, to: other }) }))
      .rejects.toBeInstanceOf(InvalidBridgeContractError);
    await expect(buildTx('across', { ...params }, { buildBridgeTx: async () => { throw new Error('network'); } }))
      .rejects.toMatchObject({ error_code: BRIDGE_ERRORS.BACKEND_BUILD_REQUEST_FAILED.error_code });
    await expect(buildTx('across', { ...params, slippage: undefined }, {}))
      .rejects.toMatchObject({ error_code: BRIDGE_ERRORS.SLIPPAGE_IS_REQUIRED_FOR_THIS_API_CALL.error_code });
    await expect(getQuote('unsupported', { ...params }, {}))
      .rejects.toMatchObject({ error_code: BRIDGE_ERRORS.UNSUPPORTED_BRIDGE_AGGREGATOR.error_code });
  });

  test('rejects a missing spender or router configuration', () => {
    const quote = { bridge_id: 'across', approve_contract_id: other };
    expect(() => validateBridgeQuote('lifi', 'not-configured', quote)).toThrow(InvalidBridgeContractError);
    expect(() => validateBridgeTx('lifi', 'not-configured', 'across', { ...tx, to: other }, params))
      .toThrow(InvalidBridgeContractError);
  });

  test('reports aggregators without a parser instead of silently counting them as covered', () => {
    const onError = jest.fn();
    const error = expectCalldataError(() => validateBridgeTx('near_intents', 'eth', 'near_intents',
      { ...tx, data: '0xdeadbeef' }, params, { onError }));
    expect(error.errors[0]).toMatchObject({ pass: false, routerPass: true, fromPass: false, toPass: false, receiverPass: false });
    expect(failures(onError)).toEqual(expect.arrayContaining([
      expect.objectContaining({ error_code: BRIDGE_ERRORS.UNSUPPORTED_CALLDATA_AGGREGATOR.error_code, blocking: true }),
    ]));
  });

  test('accepts a fully verified transaction', () => {
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
    [{ toTokenRawAmount: '100000000' }, {}, { fromPass: true, toPass: false, receiverPass: true }, BRIDGE_ERRORS.MIN_RECEIVE_MISMATCH.error_code],
    [{ toChainId: 'arb' }, {}, { fromPass: true, toPass: false, receiverPass: true }, BRIDGE_ERRORS.TO_CHAIN_MISMATCH.error_code],
    [{}, { from: other }, { fromPass: false, toPass: true, receiverPass: true }, BRIDGE_ERRORS.FROM_ADDRESS_MISMATCH.error_code],
    [{}, { chainId: 10 }, { fromPass: false, toPass: true, receiverPass: true }, BRIDGE_ERRORS.FROM_CHAIN_MISMATCH.error_code],
    [{}, { data: tx.data.slice(0, 74) + BigInt(other).toString(16).padStart(64, '0') + tx.data.slice(138) },
      { fromPass: true, toPass: true, receiverPass: false }, BRIDGE_ERRORS.RECEIVER_MISMATCH.error_code],
  ])('keeps independent results for field mismatch %#', (intent, changes, flags, code) => {
    const onError = jest.fn();
    const error = expectCalldataError(() => validateBridgeTx('across', 'eth', 'across',
      { ...tx, ...changes }, { ...params, ...intent }, { onError }));
    expect(failures(onError)).toEqual(expect.arrayContaining([
      expect.objectContaining({ error_code: code, ...flags, pass: false, blocking: true }),
    ]));
    expect(toBridgeErrorReport(error).error_code).toBe(code);
  });

  test('does not count a skipped minimum comparison as a verified destination', () => {
    const error = expectCalldataError(() => validateBridgeTx('across', 'eth', 'across', tx,
      { ...params, toTokenRawAmount: undefined }));
    expect(error.errors[0]).toMatchObject({ pass: false, fromPass: true, toPass: false, receiverPass: true,
      unverifiedFields: ['minOutputAmount'] });
  });

  test('reports an unknown destination path without losing its verified source', () => {
    const data = readFixture('quotes/routes/cases.json')
      .find((item) => item.id === 'discovery-across-destination-dex-5pct');
    const sourceTx = { ...data.tx, data: data.tx.data.replace('38c9c147', 'deadbeef') };
    const onError = jest.fn();
    const error = expectCalldataError(() => validateBridgeTx('across', data.chainKey, data.bridgeId, sourceTx,
      { ...data.request, toTokenRawAmount: data.quoteBenchmark.quotedOutputAmount }, { onError }));
    expect(error.errors[0]).toMatchObject({ pass: false, routerPass: true, fromPass: true, toPass: false, receiverPass: false });
    expect(failures(onError)).toEqual(expect.arrayContaining([
      expect.objectContaining({ error_code: BRIDGE_ERRORS.UNSUPPORTED_DESTINATION_CALL.error_code,
        method: 'deposit', hasDestinationCall: true, blocking: true }),
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
    const data = readFixture(provider === 'relay' ? 'providers/relay/quote-v2.json' : 'providers/socket/quote-v3.json');
    const sourceTx = provider === 'relay' ? data.tx : data.cases[0].tx;
    const bridgeId = provider === 'relay' ? 'relay' : data.cases[0].bridgeId;
    const quote = { bridge_id: bridgeId, quote_key: { quote_id: 'backend-selection' }, to_token_raw_amount_hex_str: '0x100' };
    const providerClient = { captureContext: jest.fn(), getQuotes: jest.fn(), buildTx: jest.fn(), verifyTx: jest.fn() };
    const onError = jest.fn();
    const api = { getBridgeQuoteListV2: jest.fn(async () => [quote]), buildBridgeTx: jest.fn(async () => sourceTx) };
    await expect(getQuoteListWithTx(provider, { ...data.params, providerClient, onError, allowMissingRelayOrder: true }, api))
      .resolves.toEqual([{ ...quote, tx: sourceTx }]);
    for (const fn of Object.values(providerClient)) expect(fn).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    const check = validateBridgeTx(provider, data.params.fromChainId, bridgeId, sourceTx, data.params, { onError, allowMissingRelayOrder: true });
    expect(check).toMatchObject({ pass: true, fromPass: true, toPass: false, receiverPass: false, errors: [] });
    expect(check.unverifiedFields).toContain('receiver');
    expect(toBridgeErrorReport(check)).toBeUndefined();
    expect(onError).not.toHaveBeenCalled();
  });

  test('LayerSwap performs no external lookup', async () => {
    const data = readFixture('providers/layerswap/pending.json');
    const providerClient = { captureContext: jest.fn(), verifyLayerSwapTx: jest.fn() };
    const onError = jest.fn();
    const intent = { userAddress: data.tx.from, fromChainId: 'eth', fromTokenId: data.expected.sourceToken,
      fromTokenRawAmount: data.expected.sourceAmount, toChainId: 'arb', toTokenId: data.expected.outputToken,
      slippage: '0.01', bridgeId: 'layerswap', providerClient, onError };
    await expect(buildTx('lifi', intent, { buildBridgeTx: async () => data.tx })).resolves.toBe(data.tx);
    expect(providerClient.captureContext).not.toHaveBeenCalled();
    expect(providerClient.verifyLayerSwapTx).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    const check = validateBridgeTx('lifi', 'eth', 'layerswap', data.tx, intent);
    expect(check).toMatchObject({ pass: true, fromPass: true, toPass: false, receiverPass: true,
      unverifiedFields: ['outputToken', 'minOutputAmount'], errors: [] });
  });

  test('throwing reporters cannot veto skipped checks', async () => {
    const data = readFixture('providers/relay/quote-v2.json');
    const onError = () => { throw new Error('reporter'); };
    await expect(buildTx('relay', { ...data.params, bridgeId: 'relay', onError, allowMissingRelayOrder: true }, { buildBridgeTx: async () => data.tx }))
      .resolves.toBe(data.tx);
  });
});
