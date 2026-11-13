import { hashRelayOrder as hash } from '../helpers/relay.js';
import { readFixture } from '../helpers/fixtures.js';
import { describe, expect, jest, test } from '@jest/globals';
import { buildTx, decodeBridgeCalldata, getQuoteListWithTx, validateBridgeTx } from '../../dist/index.js';
import { expectCalldataError } from '../helpers/assert-validation-error.js';
import { providerHistoryResponse } from '../helpers/history.js';

describe('Relay destination terms are bound to local intent', () => {
  const fixture = readFixture('providers/relay/quote-v2.json');
  const original = fixture.response.protocol.v2.orderData;
  const other = '0x1111111111111111111111111111111111111111';
  const params = { ...fixture.params, bridgeId: 'relay', toTokenRawAmount: original.output.payments[0].expectedAmount };
  const txFor = (order) => ({ ...fixture.tx, data: fixture.tx.data.slice(0, -64) + hash(order).slice(2), order_data: order });
  const verify = (order, expected = params) => validateBridgeTx('relay', expected.fromChainId, 'relay', txFor(order), {
    ...expected, orderData: order,
  });
  const freshOrder = () => structuredClone(original);

  test.each([
    ['chain', 'BRIDGE_TO_CHAIN_MISMATCH'],
    ['token', 'BRIDGE_TO_TOKEN_MISMATCH'],
    ['minimum', 'BRIDGE_MIN_RECEIVE_MISMATCH'],
  ])('rejects a changed %s even when both order and calldata hash are replaced', async (field, code) => {
    const order = freshOrder();
    if (field === 'chain') order.output.chainId = 'bnb';
    if (field === 'token') order.output.payments[0].currency = other;
    if (field === 'minimum') order.output.payments[0].minimumAmount = '1';
    const tx = txFor(order);
    expect(hash(order)).not.toBe(hash(original));
    expect(decodeBridgeCalldata('relay', tx).orderId).toBe(hash(order));
    const error = expectCalldataError(() => verify(order));
    expect(error.errors.map((item) => item.error_code)).toEqual([code]);
    expect(error.errors[0]).toMatchObject({ fromPass: true, toPass: false, receiverPass: true });

    const onError = jest.fn();
    await expect(buildTx('relay', { ...params, onError }, { buildBridgeTx: async () => tx }))
      .rejects.toMatchObject({ error_code: code });
    expect(onError).toHaveBeenCalledTimes(1);
    const report = onError.mock.calls[0][0];
    expect(report.errors[0]).toMatchObject({ error_code: code, pass: false, toPass: false, receiverPass: true, blocking: true });
    for (const sensitive of [hash(order), tx.data, params.userAddress, other]) {
      expect(JSON.stringify(report)).not.toContain(sensitive);
    }
  });

  test.each([
    ['94049999', false], ['94050000', true], ['99000000', true],
    ['103950001', true], ['200000000', true], ['0', false],
  ])('applies the shared 95%% floor with no upper cap to minimumAmount %s', async (minimum, accepted) => {
    const order = freshOrder();
    order.output.payments[0].minimumAmount = minimum;
    order.output.payments[0].expectedAmount = '100000000';
    const expected = { ...params, toTokenRawAmount: '0x5f5e100' };
    const onError = jest.fn();
    const tx = txFor(order);
    const built = buildTx('relay', { ...expected, onError }, { buildBridgeTx: async () => tx });
    if (accepted) {
      await expect(built).resolves.toBe(tx);
      expect(verify(order, expected)).toMatchObject({ pass: true, toPass: true, receiverPass: true, unverifiedFields: [] });
      expect(onError).not.toHaveBeenCalled();
    } else {
      await expect(built).rejects.toMatchObject({ error_code: 'BRIDGE_MIN_RECEIVE_MISMATCH' });
      expect(onError).toHaveBeenCalledTimes(1);
    }
  });

  test('does not use expectedAmount as the guaranteed or locally selected amount', () => {
    const order = freshOrder();
    order.output.payments[0].minimumAmount = '1';
    order.output.payments[0].expectedAmount = '1000000000000000000';
    expect(expectCalldataError(() => verify(order)).error_code).toBe('BRIDGE_MIN_RECEIVE_MISMATCH');
  });

  test.each(['base', '0x0000000000000000000000000000000000000000', '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'])(
    'compares native output alias %s using the destination chain', (toTokenId) => {
      const order = freshOrder();
      order.output.payments[0].currency = '0x0000000000000000000000000000000000000000';
      expect(verify(order, { ...params, toTokenId })).toMatchObject({ pass: true, toPass: true });
      expect(expectCalldataError(() => verify(order, { ...params, toTokenId: 'arb' })).error_code)
        .toBe('BRIDGE_TO_TOKEN_MISMATCH');
    }
  );

  test('requires the selected raw output amount once the order minimum is available', () => {
    const error = expectCalldataError(() => verify(original, { ...params, toTokenRawAmount: undefined }));
    expect(error.errors[0]).toMatchObject({ error_code: 'BRIDGE_UNVERIFIED_BRIDGE_FIELDS', toPass: false,
      receiverPass: true, unverifiedFields: ['minOutputAmount'] });
  });

  test('does not reject an unknown expected destination chain', () => {
    const expected = { ...params, toChainId: 'not-a-chain' };
    expect(verify(original, expected)).toMatchObject({ pass: true, toPass: true });
    for (const field of ['currency', 'minimumAmount']) {
      const order = freshOrder();
      order.output.payments[0][field] = field === 'currency' ? other : '1';
      const error = expectCalldataError(() => verify(order, expected));
      expect(error.error_code).toBe(field === 'currency' ? 'BRIDGE_TO_TOKEN_MISMATCH' : 'BRIDGE_MIN_RECEIVE_MISMATCH');
    }
  });

  test.each(['unknown', '__proto__', 'toString'])('rejects unsupported order chain %s', (chain) => {
    const order = freshOrder();
    order.output.chainId = chain;
    expect(expectCalldataError(() => verify(order)).error_code).toBe('BRIDGE_RELAY_ORDER_HASH_MISMATCH');
  });

  test('requires the expected destination chain even when the order hash matches', () => {
    const error = expectCalldataError(() => verify(original, { ...params, toChainId: undefined }));
    expect(error.errors[0]).toMatchObject({ error_code: 'BRIDGE_MISSING_DESTINATION_CHAIN', toPass: false, receiverPass: true });
  });

  test.each(['multiple payments', 'destination calls'])('rejects unsupported %s instead of selecting one output', (shape) => {
    const order = freshOrder();
    if (shape === 'multiple payments') order.output.payments.push({ ...order.output.payments[0] });
    else order.output.calls = ['0x12345678'];
    const error = expectCalldataError(() => verify(order));
    expect(error.errors.map((item) => item.error_code)).toContain('BRIDGE_UNSUPPORTED_RELAY_ORDER_SHAPE');
    expect(error.errors[0].toPass).toBe(false);
  });

  test('a backend await cannot replace the locally selected destination token', async () => {
    const order = freshOrder();
    order.output.payments[0].currency = other;
    const expected = { ...params };
    await expect(buildTx('relay', expected, { buildBridgeTx: async () => {
      expected.toTokenId = other;
      return txFor(order);
    } })).rejects.toMatchObject({ error_code: 'BRIDGE_TO_TOKEN_MISMATCH' });
  });

  test('quote-list builds use the quote amount and filter destination failures', async () => {
    const bad = freshOrder();
    bad.output.payments[0].minimumAmount = '1';
    const quotes = ['good', 'bad'].map((cache) => ({ bridge_id: 'relay', quote_key: { cache },
      to_token_raw_amount_hex_str: '0x' + BigInt(params.toTokenRawAmount).toString(16) }));
    const onError = jest.fn();
    const result = await getQuoteListWithTx('relay', { ...fixture.params, onError }, {
      getBridgeQuoteListV2: async () => quotes,
      buildBridgeTx: async ({ quote_key }) => txFor(JSON.parse(quote_key).cache === 'bad' ? bad : original),
    });
    expect(result).toHaveLength(1);
    expect(result[0].quote_key.cache).toBe('good');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].errors[0].error_code).toBe('BRIDGE_MIN_RECEIVE_MISMATCH');
  });

  test('captured orders verify bound destination terms without requiring funding analysis', () => {
    const cases = readFixture('providers/history/cases.json').filter((item) => item.aggregatorId === 'relay');
    let verified = 0;
    for (const item of cases) {
      const response = providerHistoryResponse(item);
      const order = response.requests.find((row) => row.data.inTxs.some((tx) => tx.hash.toLowerCase() === item.txHash.toLowerCase())).orderData;
      const expected = { userAddress: item.tx.from, fromTokenId: item.expected.sourceToken,
        fromTokenRawAmount: item.expected.sourceAmount, toChainId: item.toChainKey, toTokenId: item.expected.outputToken,
        toTokenRawAmount: item.expected.expectedOutputAmount ?? item.expected.minOutputAmount, slippage: '0.01', orderData: order };
      const check = validateBridgeTx('relay', item.chainKey, 'relay', item.tx, expected);
      expect(check).toMatchObject({ pass: true, toPass: true, receiverPass: true, unverifiedFields: [] });
      verified++;
    }
    expect(verified).toBe(60);
  });
});

describe('Relay source swap address checks', () => {
  const tx = readFixture('providers/relay/source-swap.json');
  const params = {
    userAddress: tx.from, fromChainId: 'bsc', bridgeId: 'relay',
    fromTokenId: '0x924fa68a0fc644485b8df8abfa0a41c2e7744444',
    fromTokenRawAmount: '12940444726322136052',
    toChainId: 'hyper', toTokenId: 'hyper',
    toTokenRawAmount: tx.order_data.output.payments[0].expectedAmount, slippage: '0.01',
    quoteKey: { quote_id: `0x${'12'.repeat(32)}:source-swap-regression` },
  };

  test('accepts the reported transaction without claiming its intermediate funding was verified', async () => {
    const parsed = decodeBridgeCalldata('relay', tx);
    expect(parsed.orderId).toBe(hash(tx.order_data));
    expect(parsed.sourceToken).not.toBe(tx.order_data.inputs[0].payment.currency);
    expect(parsed.bridgeAmount).toBeUndefined();
    const onError = jest.fn();
    await expect(buildTx('relay', { ...params, onError }, { buildBridgeTx: async () => tx })).resolves.toBe(tx);
    expect(onError).not.toHaveBeenCalled();
    expect(validateBridgeTx('relay', 'bsc', 'relay', tx, { ...params, orderData: tx.order_data }))
      .toMatchObject({ pass: true, fromPass: true, toPass: true, receiverPass: true });
  });

  test.each([
    ['recipient', 'BRIDGE_RECEIVER_MISMATCH'],
    ['refund', 'BRIDGE_RELAY_REFUND_RECIPIENT_MISMATCH'],
  ])('rejects another %s even with a matching new order hash', (field, code) => {
    const order = structuredClone(tx.order_data);
    const other = '0x1111111111111111111111111111111111111111';
    if (field === 'recipient') order.output.payments[0].recipient = other;
    else order.inputs[0].refunds[0].recipient = other;
    const changed = { ...tx, data: tx.data.replaceAll(hash(tx.order_data).slice(2), hash(order).slice(2)) };
    const error = expectCalldataError(() => validateBridgeTx('relay', 'bsc', 'relay', changed, { ...params, orderData: order }));
    expect(error.errors.map((item) => item.error_code)).toContain(code);
    expect(error.errors.map((item) => item.error_code)).not.toContain('BRIDGE_RELAY_ORDER_HASH_MISMATCH');
  });

  test('still rejects order data that does not match the calldata hash', () => {
    const order = { ...tx.order_data, salt: '1' };
    const error = expectCalldataError(() => validateBridgeTx('relay', 'bsc', 'relay', tx, { ...params, orderData: order }));
    expect(error.errors.map((item) => item.error_code)).toContain('BRIDGE_RELAY_ORDER_HASH_MISMATCH');
  });
});

describe('[Relay] complete Bridge Lab capture', () => {
  // Only complete SDK validation inputs; recorded outcomes precede the request-ID fix.
  const capture = readFixture('providers/relay/lab.json');
  const responses = capture.records;
  const previousRejections = responses.filter((record) => record.validationFailed);
  const intentFor = (record) => ({
    userAddress: record.userAddress, bridgeId: record.bridgeId,
    fromChainId: record.fromChainId, fromTokenId: record.fromTokenId,
    fromTokenRawAmount: record.rawAmount, toChainId: record.toChainId, toTokenId: record.toTokenId,
    toTokenRawAmount: record.quote.toTokenRawAmountHex, slippage: record.buildRequest.slippage,
    feeRate: record.feeRate, quoteKey: record.quote.quoteKey,
  });

  test('contains only complete transactions and order data for SDK validation', () => {
    expect(responses).toHaveLength(53);
    expect(new Set(responses.map((record) => record.id)).size).toBe(53);
    expect(previousRejections).toHaveLength(4);
    expect(capture.records.filter((record) => record.buildSucceeded)).toHaveLength(49);
    for (const record of responses) {
      expect(record.aggregatorId).toBe('relay');
      expect(record.orderDataSource).toBe('response');
      expect(record.buildError).toBeNull();
      expect(record.buildResponse).toMatchObject({
        data: expect.stringMatching(/^0x(?:[0-9a-f]{2}){4,}$/i), order_data: expect.any(Object),
      });
      expect(record.buildResponse.order_data).toEqual(record.orderData);
      expect(record.tx).toMatchObject(record.buildResponse);
      expect(record.tx.dataLength).toBe((record.buildResponse.data.length - 2) / 2);
      expect(record.tx.selector).toBe(record.buildResponse.data.slice(0, 10));
    }
  });

  test.each(responses)('$id passes strict validation with its original selected quote and order data', async (record) => {
    const params = intentFor(record);
    const tx = structuredClone(record.buildResponse);
    const onError = jest.fn();
    const api = { buildBridgeTx: jest.fn(async () => tx) };
    await expect(buildTx('relay', { ...params, onError }, api)).resolves.toBe(tx);
    expect(api.buildBridgeTx).toHaveBeenCalledWith(record.buildRequest);
    expect(onError).not.toHaveBeenCalled();
    expect(validateBridgeTx('relay', params.fromChainId, 'relay', tx, { ...params, orderData: record.orderData }))
      .toMatchObject({ pass: true, routerPass: true, fromPass: true, toPass: true,
        receiverPass: true, errors: [], unverifiedFields: [] });
  });

  test.each(previousRejections)('$id records the actual metadata/request ID difference that caused the old rejection', (record) => {
    const parsed = decodeBridgeCalldata('relay', record.buildResponse);
    expect(record.errorCodes).toEqual(['BRIDGE_REQUEST_ID_MISMATCH']);
    expect(parsed.method).toBe('multicall');
    expect(parsed.orderId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(parsed.requestId).not.toBe(record.quote.quoteKey.quote_id.split(':')[0]);
  });

  test.each(['missing order data', 'changed order hash', 'missing internal order ID'])(
    'still blocks %s on a captured multicall', (kind) => {
      const record = previousRejections[0];
      const tx = structuredClone(record.buildResponse);
      const params = { ...intentFor(record), orderData: structuredClone(record.orderData) };
      const parsed = decodeBridgeCalldata('relay', tx);
      let expected;
      if (kind === 'missing order data') {
        delete params.orderData;
        expected = 'BRIDGE_MISSING_RELAY_ORDER_DATA';
      } else if (kind === 'changed order hash') {
        params.orderData.salt = '0x' + '12'.repeat(32);
        expected = 'BRIDGE_RELAY_ORDER_HASH_MISMATCH';
      } else {
        tx.data = tx.data.replaceAll(parsed.orderId.slice(2), '00'.repeat(32));
        expected = 'BRIDGE_MISSING_RELAY_ORDER_ID';
      }
      const error = expectCalldataError(() => validateBridgeTx('relay', record.fromChainId, 'relay', tx, params));
      expect(error.errors.map((item) => item.error_code)).toContain(expected);
    }
  );
});
