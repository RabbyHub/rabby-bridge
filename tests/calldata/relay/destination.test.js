import { hashRelayOrder as hash } from '../../helpers/relay.js';
import { readFixture as read } from '../../helpers/fixtures.js';
import { describe, expect, jest, test } from '@jest/globals';
import { buildTx, decodeBridgeCalldata, getQuoteListWithTx, validateBridgeTx } from '../../../dist/index.js';
import { expectCalldataError } from '../../helpers/assert-validation-error.js';

const fixture = read('providers/relay/quote-v2.json');
const original = fixture.response.protocol.v2.orderData;
const other = '0x1111111111111111111111111111111111111111';
const params = { ...fixture.params, bridgeId: 'relay', toTokenRawAmount: original.output.payments[0].expectedAmount };
const txFor = (order) => ({ ...fixture.tx, data: fixture.tx.data.slice(0, -64) + hash(order).slice(2), order_data: order });
const verify = (order, expected = params) => validateBridgeTx('relay', expected.fromChainId, 'relay', txFor(order), {
  ...expected, orderData: order,
});
const freshOrder = () => structuredClone(original);

describe('Relay destination terms are bound to local intent', () => {
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
    const cases = read('providers/history/cases.json').filter((item) => item.aggregatorId === 'relay');
    let verified = 0;
    for (const item of cases) {
      const response = read('providers/' + item.providerHistory.responseFile);
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
