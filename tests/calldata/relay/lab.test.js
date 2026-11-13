import { readFixture } from '../../helpers/fixtures.js';
import { describe, expect, jest, test } from '@jest/globals';
import { buildTx, decodeBridgeCalldata, validateBridgeTx } from '../../../dist/index.js';
import { expectCalldataError } from '../../helpers/assert-validation-error.js';

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

describe('[Relay] complete Bridge Lab capture', () => {
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
