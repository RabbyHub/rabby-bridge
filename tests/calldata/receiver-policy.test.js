import { hashRelayOrder as hashOrder } from '../helpers/relay.js';
import { word, bytes } from '../helpers/calldata.js';
import { readFixture as read } from '../helpers/fixtures.js';
import { describe, expect, jest, test } from '@jest/globals';
import { buildTx, decodeBridgeCalldata, validateBridgeTx } from '../../dist/index.js';
import { expectCalldataError } from '../helpers/assert-validation-error.js';

const socket = read('providers/socket/quote-v3.json');
const relay = read('providers/relay/quote-v2.json');
const history = read('regressions/history-success.json');
const relayTransactions = [
  ...read('providers/relay/lab.json').records.flatMap((record) => record.buildResponse ? [record.buildResponse] : []),
  read('providers/relay/source-swap.json'),
];
const cctp = socket.cases.find((item) => item.bridgeId === 'cctp-v2');
const rfq = socket.cases.find((item) => item.bridgeId === 'rfq-vault-executor');
const mint = '424a31a57f7c63918ecaa2fac38016a8af5a6ec2';
const user = '341a1fbd51825e5a107db54ccb3166deba145479';
const other = '1111111111111111111111111111111111111111';
const orderData = relay.response.protocol.v2.orderData;
const codes = (result) => result.errors.map((error) => error.error_code);
const replace = (tx, before, after) => ({ ...tx, data: tx.data.replaceAll(before, after) });

const relayIntent = { ...relay.params, toTokenRawAmount: orderData.output.payments[0].expectedAmount, orderData };
const socketIntent = { ...socket.params };
const badOrderId = `0x${'ab'.repeat(32)}`;
const goodOrderId = relay.response.protocol.v2.orderId;
const deposit = (orderId) => relay.tx.data.slice(0, -64) + orderId.slice(2);
const router = '0x0729e2a4716d9f7dd17858d5d504426d228697f7';
const approvalProxy = '0x5567954cd026cebfe486062cb75848e0f1c12e58';
const call = (data, target = relay.tx.to, allowFailure = false) => ({ data, target, allowFailure });
const encodeCalls = (calls) => {
  const encoded = calls.map((item) => word(item.target) + word(item.allowFailure) + word(item.value ?? 0) + word(128) + bytes(item.data));
  let offset = calls.length * 32;
  const offsets = encoded.map((item) => { const current = offset; offset += item.length / 2; return word(current); });
  return word(calls.length) + offsets.join('') + encoded.join('');
};
const multicallTx = (calls, metadata = `0x${'cd'.repeat(32)}`) => {
  const callArray = encodeCalls(calls);
  const tokens = word(1) + word(relay.params.fromTokenId);
  const amounts = word(1) + word(relay.params.fromTokenRawAmount);
  return { ...relay.tx, to: approvalProxy, data: '0xf9e4bab4' + word(192) + word(256) + word(320) +
    word(relay.params.userAddress) + word(0) + word(320 + callArray.length / 2) +
    tokens + amounts + callArray + bytes(metadata) };
};
const cleanupNative = (data, target = relay.tx.to) => '0x5d1fe6a2' + word(0) + word(target) + word(96) + bytes(data);
const cleanupErc20 = (data, target = relay.tx.to, token = relay.params.fromTokenId) => {
  const arrays = [word(1) + word(token), word(1) + word(target), word(1) + word(32) + bytes(data), word(1) + word(0)];
  let offset = 128;
  return '0x73b7bb2f' + arrays.map((array) => { const current = offset; offset += array.length / 2; return word(current); }).join('') + arrays.join('');
};

describe('receiver check policy', () => {
  test('accepts the fixed CCTP mint recipient and still rejects any other recipient', () => {
    const allowed = validateBridgeTx('socket', cctp.chainKey, cctp.bridgeId, cctp.tx, socketIntent);
    expect(codes(allowed)).not.toContain('BRIDGE_RECEIVER_MISMATCH');
    expect(allowed.receiverPass).toBe(false);
    expect(allowed.unverifiedFields).toContain('receiver');
    expect(allowed.errors).toEqual([]);

    const ownWalletTx = replace(cctp.tx, mint, user);
    const ownWallet = validateBridgeTx('socket', cctp.chainKey, cctp.bridgeId, ownWalletTx, {
      ...socketIntent, toTokenRawAmount: decodeBridgeCalldata('socket', ownWalletTx).minOutputAmount.toString(), slippage: '0',
    });
    expect(codes(ownWallet)).not.toContain('BRIDGE_RECEIVER_MISMATCH');

    const changed = expectCalldataError(() => validateBridgeTx('socket', cctp.chainKey, cctp.bridgeId, replace(cctp.tx, mint, other), socketIntent));
    expect(codes(changed)).toContain('BRIDGE_RECEIVER_MISMATCH');
    expect(changed.errors.find((error) => error.error_code === 'BRIDGE_RECEIVER_MISMATCH').blocking).toBe(true);
    expect(changed.errors[0].pass).toBe(false);
  });

  test.each(['zero', 'one'])('verifies order addresses without claiming funding after input was drained to %s unit', (left) => {
    const remaining = left === 'zero' ? 0n : 1n;
    const amount = BigInt(relay.params.fromTokenRawAmount);
    const drain = '0xa9059cbb' + word(`0x${other}`) + word(amount - remaining);
    const inner = '0xe8017952' + word(relay.params.userAddress) + word(relay.params.fromTokenId) +
      word(remaining || amount) + goodOrderId.slice(2);
    const tx = multicallTx([call(drain, relay.params.fromTokenId), call(cleanupErc20(inner), router)]);
    const checked = validateBridgeTx('relay', relay.params.fromChainId, 'relay', tx, relayIntent);
    expect(checked).toMatchObject({ pass: true, fromPass: true, receiverPass: true, errors: [] });
    expect(decodeBridgeCalldata('relay', tx).bridgeAmount).toBeUndefined();
  });

  test.each(['amount', 'currency', 'chainId'])('does not compare order input %s when checking order addresses', (field) => {
    const order = structuredClone(orderData);
    order.inputs[0].payment[field] = { amount: '1', currency: `0x${other}`, chainId: 'bnb' }[field];
    const tx = { ...relay.tx, data: deposit(hashOrder(order)) };
    expect(validateBridgeTx('relay', relay.params.fromChainId, 'relay', tx, { ...relayIntent, orderData: order }))
      .toMatchObject({ pass: true, receiverPass: true, errors: [] });
  });

  test('does not infer a direct allowance-based deposit amount from order data', () => {
    const tx = { ...relay.tx, data: '0x5a1ee3ac' + word(relay.params.userAddress) +
      word(relay.params.fromTokenId) + goodOrderId.slice(2) };
    const checked = expectCalldataError(() => validateBridgeTx('relay', relay.params.fromChainId, 'relay', tx, relayIntent));
    expect(codes(checked)).toContain('BRIDGE_UNVERIFIED_BRIDGE_FIELDS');
    expect(checked.errors[0].receiverPass).toBe(true);
  });

  test('requires cleanup to run on the Router actually funded by the ApprovalProxy', () => {
    const tx = multicallTx([call(cleanupErc20(deposit(goodOrderId)), '0x6328ea02d28131e58b28e55c6258258a30d90e05')]);
    const checked = expectCalldataError(() => validateBridgeTx('relay', relay.params.fromChainId, 'relay', tx, relayIntent));
    expect(codes(checked)).toContain('BRIDGE_RELAY_CANONICAL_DEPOSITORY_MISMATCH');
    expect(checked.errors[0].receiverPass).toBe(false);
  });

  test.each(['explicit', 'allowance'])('verifies a simple approval followed by an %s deposit', (shape) => {
    const approval = '0x095ea7b3' + word(relay.tx.to) + word(relay.params.fromTokenRawAmount);
    const inner = shape === 'explicit' ? deposit(goodOrderId) : '0x5a1ee3ac' + word(relay.params.userAddress) +
      word(relay.params.fromTokenId) + goodOrderId.slice(2);
    const tx = multicallTx([call(approval, relay.params.fromTokenId), call(inner)]);
    expect(validateBridgeTx('relay', relay.params.fromChainId, 'relay', tx, relayIntent))
      .toMatchObject({ receiverPass: true, errors: [] });
  });

  test.each(['direct', 'multicall', 'cleanup'])('verifies known native funding for a %s deposit', (shape) => {
    const order = structuredClone(orderData);
    order.inputs[0].payment.currency = '0x0000000000000000000000000000000000000000';
    order.inputs[0].payment.amount = '100';
    const data = '0x49290c1c' + word(relay.params.userAddress) + hashOrder(order).slice(2);
    let tx = { ...relay.tx, data, value: '0x64' };
    if (shape !== 'direct') {
      const calls = encodeCalls([shape === 'cleanup' ? call(cleanupNative(data), router) : { ...call(data), value: 100n }]);
      tx = { ...tx, to: router, data: '0xcd6e13f7' + word(128) + word(relay.params.userAddress) + word(0) +
        word(128 + calls.length / 2) + calls + bytes(`0x${'cd'.repeat(32)}`) };
    }
    const checked = validateBridgeTx('relay', relay.params.fromChainId, 'relay', tx,
      { ...relayIntent, fromTokenId: 'arb', fromTokenRawAmount: '100', orderData: order });
    expect(checked).toMatchObject({ receiverPass: true, errors: [] });
  });

  test('keeps the Socket RFQ check on the fixed source vault', () => {
    const allowed = validateBridgeTx('socket', rfq.chainKey, rfq.bridgeId, rfq.tx, socketIntent);
    expect(codes(allowed)).not.toContain('BRIDGE_RECEIVER_MISMATCH');
    expect(allowed.receiverPass).toBe(false);
    const vault = '97caca78ac2a94c67643d07843f85afaa44a3ea5';
    const moved = expectCalldataError(() => validateBridgeTx('socket', rfq.chainKey, rfq.bridgeId, replace(rfq.tx, vault, other), socketIntent));
    expect(codes(moved)).toContain('BRIDGE_UNSUPPORTED_SOCKET_RFQ_TARGET_SPENDER_OR_VALUE');
  });

  test('recomputes a direct Relay deposit from orderData', () => {
    const checked = validateBridgeTx('relay', relay.params.fromChainId, 'relay', relay.tx, relayIntent);
    expect(checked.receiverPass).toBe(true);
    expect(checked.unverifiedFields).not.toContain('receiver');
    expect(checked.toPass).toBe(true);
    expect(checked.unverifiedFields).toEqual([]);
    expect(codes(checked)).not.toEqual(expect.arrayContaining([
      'BRIDGE_RELAY_ORDER_HASH_MISMATCH', 'BRIDGE_RECEIVER_MISMATCH', 'BRIDGE_RELAY_REFUND_RECIPIENT_MISMATCH',
    ]));

    const paidElsewhere = structuredClone(orderData);
    paidElsewhere.output.payments[0].recipient = `0x${other}`;
    const recipient = expectCalldataError(() => validateBridgeTx('relay', relay.params.fromChainId, 'relay', relay.tx, { ...relayIntent, orderData: paidElsewhere }));
    expect(codes(recipient)).toEqual(expect.arrayContaining(['BRIDGE_RELAY_ORDER_HASH_MISMATCH', 'BRIDGE_RECEIVER_MISMATCH']));
    expect(recipient.errors[0].receiverPass).toBe(false);

    const refundedElsewhere = structuredClone(orderData);
    refundedElsewhere.inputs[0].refunds[0].recipient = `0x${other}`;
    const refund = expectCalldataError(() => validateBridgeTx('relay', relay.params.fromChainId, 'relay', relay.tx, { ...relayIntent, orderData: refundedElsewhere }));
    expect(codes(refund)).toContain('BRIDGE_RELAY_REFUND_RECIPIENT_MISMATCH');
    expect(refund.errors[0].receiverPass).toBe(false);
    expect(recipient.errors.every((error) => error.blocking === true)).toBe(true);
  });

  test.each(['direct', 'cleanup'])('marks a verified %s multicall receiver as checked', (shape) => {
    const final = shape === 'direct' ? call(deposit(goodOrderId)) : call(cleanupErc20(deposit(goodOrderId)), router);
    const checked = validateBridgeTx('relay', relay.params.fromChainId, 'relay', multicallTx([final]), relayIntent);
    expect(checked.receiverPass).toBe(true);
    expect(checked.unverifiedFields).not.toContain('receiver');
    expect(checked.errors).toEqual([]);
  });

  test('includes the verified receiver flag when reporting an independent source mismatch', () => {
    const onError = jest.fn();
    const checked = expectCalldataError(() => validateBridgeTx('relay', relay.params.fromChainId, 'relay', relay.tx,
      { ...relayIntent, fromTokenRawAmount: '1' }, { onError }));
    expect(checked.errors[0]).toMatchObject({ fromPass: false, receiverPass: true });
    expect(onError.mock.calls[0][0].errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ error_code: 'BRIDGE_FROM_AMOUNT_MISMATCH', receiverPass: true }),
    ]));
  });

  test('reads the final order id inside Relay multicalls', () => {
    const methods = new Set();
    let count = 0;
    for (const tx of relayTransactions) {
      const decoded = decodeBridgeCalldata('relay', tx);
      if (!decoded || !['multicall', 'transferAndMulticall'].includes(decoded.method ?? '')) continue;
      methods.add(decoded.method);
      count++;
      expect(decoded.orderId).toBe(hashOrder(tx.order_data));
      expect(tx.data.toLowerCase()).toContain(decoded.orderId.slice(2));
    }
    expect([...methods].sort()).toEqual(['multicall', 'transferAndMulticall']);
    expect(count).toBe(5);
  });

  test.each(['direct', 'cleanup'])('ignores a forged metadata deposit after the %s deposit', (shape) => {
    const data = deposit(badOrderId);
    const final = shape === 'direct' ? call(data) : call(cleanupErc20(data), router);
    const tx = multicallTx([final], `0x${'cd'.repeat(32)}${deposit(goodOrderId).slice(2)}`);
    expect(decodeBridgeCalldata('relay', tx).orderId).toBe(badOrderId);
    const checked = expectCalldataError(() => validateBridgeTx('relay', relay.params.fromChainId, 'relay', tx, relayIntent));
    expect(codes(checked)).toContain('BRIDGE_RELAY_ORDER_HASH_MISMATCH');
    expect(checked.errors[0].receiverPass).toBe(false);
    expect(checked.errors[0].pass).toBe(false);
    expect(checked.errors.every((error) => error.blocking === true)).toBe(true);
  });

  test.each([
    ['empty calls', []],
    ['unknown target', [call(deposit(goodOrderId), `0x${other}`)]],
    ['optional deposit', [call(deposit(goodOrderId), relay.tx.to, true)]],
    ['multiple deposits', [call(deposit(badOrderId)), call(deposit(goodOrderId))]],
    ['deposit followed by another call', [call(deposit(goodOrderId)), call('0x', `0x${other}`)]],
    ['unknown cleanup router', [call(cleanupErc20(deposit(goodOrderId)), `0x${other}`)]],
    ['unknown cleanup destination', [call(cleanupErc20(deposit(goodOrderId), `0x${other}`), router)]],
    ['wrong cleanup token', [call(cleanupErc20(deposit(goodOrderId), relay.tx.to, `0x${other}`), router)]],
    ['native cleanup with ERC20 deposit', [call(cleanupNative(deposit(goodOrderId)), router)]],
    ['malformed cleanup', [call('0x73b7bb2f', router)]],
  ])('reports unresolved order data for %s', (_, calls) => {
    const tx = multicallTx(calls, `0x${'cd'.repeat(32)}${deposit(goodOrderId).slice(2)}`);
    expect(decodeBridgeCalldata('relay', tx).orderId).toBeUndefined();
    const checked = expectCalldataError(() => validateBridgeTx('relay', relay.params.fromChainId, 'relay', tx, relayIntent));
    expect(codes(checked)).toContain('BRIDGE_MISSING_RELAY_ORDER_ID');
    expect(checked.errors[0].receiverPass).toBe(false);
    expect(checked.errors[0].pass).toBe(false);
    expect(checked.errors.every((error) => error.blocking === true)).toBe(true);
  });

  test('rejects Relay validation when orderData is missing', () => {
    const missing = expectCalldataError(() => validateBridgeTx('relay', relay.params.fromChainId, 'relay', relay.tx, relay.params));
    expect(codes(missing)).toContain('BRIDGE_MISSING_RELAY_ORDER_DATA');
    expect(missing.errors[0].blocking).toBe(true);
    expect(missing.errors[0].pass).toBe(false);
  });

  test('reports supplied order data even if calldata itself cannot be decoded', () => {
    const tx = { ...relay.tx, data: '0x12345678' };
    expect(codes(expectCalldataError(() => validateBridgeTx('relay', relay.params.fromChainId, 'relay', tx, relayIntent))))
      .toContain('BRIDGE_MISSING_RELAY_ORDER_ID');
  });

  test('checks the nested depository against the source chain', () => {
    const tx = multicallTx([call(deposit(goodOrderId), '0x59916da825d2d2ec1bf878d71c88826f6633ecca')]);
    const checked = expectCalldataError(() => validateBridgeTx('relay', relay.params.fromChainId, 'relay', tx, relayIntent));
    expect(codes(checked)).toContain('BRIDGE_RELAY_CANONICAL_DEPOSITORY_MISMATCH');
    expect(checked.errors[0].receiverPass).toBe(false);
  });

  test('a legacy Smart Deposits flag cannot suppress receiver rejection', async () => {
    const record = history.find((item) => item.id === '6bf4bf7858aa44d2129211339a937b29');
    const decoded = decodeBridgeCalldata('lifi', record.tx);
    const base = {
      userAddress: record.userAddress,
      fromChainId: record.chainKey,
      fromTokenId: record.fromTokenId,
      fromTokenRawAmount: decoded.sourceAmount.toString(),
      toChainId: record.toChainId,
      toTokenId: record.toTokenId,
      toTokenRawAmount: decoded.minOutputAmount?.toString(),
      slippage: record.slippage,
      smartDeposits: true,
    };
    expect(codes(expectCalldataError(() => validateBridgeTx('lifi', record.chainKey, record.bridgeId, record.tx, base))))
      .toContain('BRIDGE_RECEIVER_MISMATCH');
    const onError = jest.fn();
    const built = buildTx('lifi', { ...base, bridgeId: record.bridgeId, onError }, {
      buildBridgeTx: async () => ({ ...record.tx, smart_deposits: true }),
    });
    await expect(built).rejects.toMatchObject({ errors: expect.arrayContaining([
      expect.objectContaining({ error_code: 'BRIDGE_RECEIVER_MISMATCH', pass: false, blocking: true }),
    ]) });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].errors.map((error) => error.error_code)).toContain('BRIDGE_RECEIVER_MISMATCH');
  });

  test.each(['flat', 'legacy'])('reads Relay order data from the %s build response', async (shape) => {
    const onError = jest.fn();
    const apiFor = (order) => shape === 'flat'
      ? { buildBridgeTx: async () => ({ ...relay.tx, order_data: order }) }
      : { getBridgeQuoteTxV2: async () => ({ tx: relay.tx, order_data: order }) };
    await expect(buildTx('relay', { ...relayIntent, bridgeId: 'relay', onError }, apiFor(orderData))).resolves.toMatchObject(relay.tx);
    expect(onError).not.toHaveBeenCalled();

    const changed = structuredClone(orderData);
    changed.salt = `0x${'ab'.repeat(32)}`;
    await expect(buildTx('relay', { ...relayIntent, bridgeId: 'relay', onError }, apiFor(changed)))
      .rejects.toMatchObject({ errors: expect.arrayContaining([
        expect.objectContaining({ error_code: 'BRIDGE_RELAY_ORDER_HASH_MISMATCH', pass: false, blocking: true }),
      ]) });
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
