import { word } from '../helpers/calldata.js';
import { readFixture as read } from '../helpers/fixtures.js';
import { describe, expect, jest, test } from '@jest/globals';
import { buildTx, decodeBridgeCalldata, getBridgeRouter, validateBridgeTx } from '../../dist/index.js';

const user = '0x1111111111111111111111111111111111111111';
const other = '0x2222222222222222222222222222222222222222';
const input = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const output = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const words = (values) => values.map(word).join('');
const code = 'BRIDGE_REFUND_RECIPIENT_MISMATCH';
const intent = { userAddress: user, fromChainId: 'eth', toChainId: 'base', fromTokenId: input,
  fromTokenRawAmount: '10000000', toTokenId: output, toTokenRawAmount: '9900000', slippage: '0' };

const expectationFor = (item) => {
  const parsed = decodeBridgeCalldata(item.aggregatorId, item.tx);
  return { userAddress: item.tx.from, fromChainId: item.chainKey, toChainId: item.toChainKey,
    fromTokenId: parsed.sourceToken, fromTokenRawAmount: parsed.sourceAmount.toString(),
    toTokenId: parsed.outputToken, toTokenRawAmount: parsed.minOutputAmount.toString(), slippage: '0' };
};

async function rejectsRefund(aggregator, bridgeId, tx, params) {
  const onError = jest.fn();
  await expect(buildTx(aggregator, { ...params, bridgeId, onError }, { buildBridgeTx: async () => tx }))
    .rejects.toMatchObject({ error_code: code });
  expect(onError).toHaveBeenCalledTimes(1);
  expect(onError.mock.calls[0][0].errors).toEqual(expect.arrayContaining([
    expect.objectContaining({ error_code: code, pass: false, fromPass: true, toPass: true,
      receiverPass: false, blocking: true }),
  ]));
  const report = JSON.stringify(onError.mock.calls);
  for (const sensitive of [tx.data, params.userAddress, other]) expect(report).not.toContain(sensitive);
}

const acrossTx = (shape, refund) => {
  const bridge = words([1, 320, 352, 0, input, user, 10000000, 8453, shape === 'swap', 0, 0, 0]);
  const across = words([user, refund, input, output, 9900000, 10n ** 18n, 0, 1794499200, 1794501000, 0, 352, 0]);
  const packed = words([0, user, refund, 8453, output, 9900000, 0, 1794499200, 1794501000, 0, 352, 0]);
  let data;
  if (shape === 'standard') data = '0xa1f1ce43' + words([64, 64 + bridge.length / 2]) + bridge + across;
  else if (shape === 'swap') {
    const swaps = words([1, 32, input, input, input, input, 10000000, 224, 1, 0]);
    data = '0x1794958f' + words([96, 96 + bridge.length / 2, 96 + (bridge.length + swaps.length) / 2]) + bridge + swaps + across;
  } else if (shape === 'packed_erc20') data = '0x7260352d' + words([96, input, 10000000]) + packed;
  else data = '0x72dd147e' + word(32) + packed;
  return { from: user, to: getBridgeRouter('lifi', 'eth'), data,
    value: shape === 'packed_native' ? '0x989680' : '0x0', chainId: 1 };
};

describe('refund beneficiaries are checked independently of the final receiver', () => {
  test.each(['standard', 'swap', 'packed_erc20', 'packed_native'])(
    'LI.FI Across %s only accepts the user as refund beneficiary', async (shape) => {
      const params = { ...intent, fromTokenId: shape === 'packed_native' ? 'eth' : input };
      const safe = acrossTx(shape, user);
      expect(decodeBridgeCalldata('lifi', safe).refundRecipients).toEqual([user]);
      expect(validateBridgeTx('lifi', 'eth', 'across', safe, params)).toMatchObject({ pass: true, receiverPass: true });
      await rejectsRefund('lifi', 'across', acrossTx(shape, other), params);
      await rejectsRefund('lifi', 'across', acrossTx(shape, 0), params);
    }
  );

  const intents = read('onchain/lifi/lifiIntents.json');
  test.each(['0x7dbcf1d9', '0x6d21c5df'])('LI.FI Intent %s checks its deposit/refund owner', async (selector) => {
    let item = intents.find((row) => !decodeBridgeCalldata('lifi', row.tx).hasDestinationCall);
    expect(item).toBeDefined();
    if (selector === '0x7dbcf1d9') {
      // Captured routes include a source swap; reuse the bridge and intent tuples for a direct entry.
      const offset = (slot) => 10 + Number(BigInt('0x' + item.tx.data.slice(10 + slot * 64, 10 + (slot + 1) * 64))) * 2;
      let bridge = item.tx.data.slice(offset(0), offset(1));
      bridge = bridge.slice(0, 8 * 64) + word(0) + bridge.slice(9 * 64);
      const data = selector + words([64, 64 + bridge.length / 2]) + bridge + item.tx.data.slice(offset(2));
      const parsed = decodeBridgeCalldata('lifi', { ...item.tx, data });
      item = { ...item, tx: { ...item.tx, data,
        value: BigInt(parsed.sourceToken) === 0n ? parsed.sourceAmount.toString() : '0x0' } };
    }
    const params = expectationFor(item);
    expect(validateBridgeTx('lifi', item.chainKey, item.bridgeId, item.tx, params).pass).toBe(true);
    const slot = selector === '0x6d21c5df' ? 2 : 1;
    const offset = Number(BigInt('0x' + item.tx.data.slice(10 + slot * 64, 10 + (slot + 1) * 64)));
    const start = 10 + (offset + 64) * 2;
    const tx = { ...item.tx, data: item.tx.data.slice(0, start) + word(other) + item.tx.data.slice(start + 64) };
    expect(decodeBridgeCalldata('lifi', tx).receiver).toBe(params.userAddress.toLowerCase());
    await rejectsRefund('lifi', item.bridgeId, tx, params);
  });

  describe.each(['arbitrum-native', 'robinhood-native'])('Socket %s', (bridgeId) => {
    const native = read(`onchain/socket/${bridgeId}.json`)
      .find((item) => item.tx.data.includes('679b6ded'));
    const nativeIntent = expectationFor(native);
    const refundAt = (tx, slot, recipient) => {
      const start = tx.data.indexOf('679b6ded') + 8 + slot * 64;
      return { ...tx, data: tx.data.slice(0, start) + word(recipient) + tx.data.slice(start + 64) };
    };
    const safeNative = refundAt(refundAt(native.tx, 3, nativeIntent.userAddress), 4, nativeIntent.userAddress);

    test('retryable passes when both refund recipients are the user', async () => {
      expect(decodeBridgeCalldata('socket', safeNative).refundRecipients)
        .toEqual([nativeIntent.userAddress.toLowerCase(), nativeIntent.userAddress.toLowerCase()]);
      expect(validateBridgeTx('socket', native.chainKey, native.bridgeId, safeNative, nativeIntent))
        .toMatchObject({ pass: true, receiverPass: true });
      await expect(buildTx('socket', { ...nativeIntent, bridgeId: native.bridgeId }, { buildBridgeTx: async () => safeNative }))
        .resolves.toBe(safeNative);
    });

    test.each([3, 4])('retryable rejects refund parameter %s pointing elsewhere', async (slot) => {
      await rejectsRefund('socket', native.bridgeId, refundAt(safeNative, slot, other), nativeIntent);
    });

    test('a historical success does not make third-party refund beneficiaries safe', async () => {
      expect(decodeBridgeCalldata('socket', native.tx).refundRecipients.every((recipient) =>
        recipient !== nativeIntent.userAddress.toLowerCase())).toBe(true);
      await rejectsRefund('socket', native.bridgeId, native.tx, nativeIntent);
    });
  });
});
