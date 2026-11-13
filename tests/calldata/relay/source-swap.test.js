import { hashRelayOrder as hash } from '../../helpers/relay.js';
import { readFixture as read } from '../../helpers/fixtures.js';
import { describe, expect, jest, test } from '@jest/globals';
import { buildTx, decodeBridgeCalldata, validateBridgeTx } from '../../../dist/index.js';
import { expectCalldataError } from '../../helpers/assert-validation-error.js';

const tx = read('providers/relay/source-swap.json');
const params = {
  userAddress: tx.from, fromChainId: 'bsc', bridgeId: 'relay',
  fromTokenId: '0x924fa68a0fc644485b8df8abfa0a41c2e7744444',
  fromTokenRawAmount: '12940444726322136052',
  toChainId: 'hyper', toTokenId: 'hyper',
  toTokenRawAmount: tx.order_data.output.payments[0].expectedAmount, slippage: '0.01',
  quoteKey: { quote_id: `0x${'12'.repeat(32)}:source-swap-regression` },
};

describe('Relay source swap address checks', () => {
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
