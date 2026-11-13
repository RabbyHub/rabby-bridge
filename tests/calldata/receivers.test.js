import { hashRelayOrder as hashOrder } from '../helpers/relay.js';
import { word, bytes } from '../helpers/calldata.js';
import { readFixture } from '../helpers/fixtures.js';
import { describe, expect, jest, test } from '@jest/globals';
import {
  buildTx,
  decodeBridgeCalldata,
  validateBridgeTx,
  validateBridgeCalldata,
  getBridgeRouter,
} from '../../dist/index.js';
import { expectCalldataError } from '../helpers/assert-validation-error.js';
import { applyAcrossMessage, readDestinationTransfers } from '../../dist/calldata/destination.js';
import { decodeFastMctpBridge } from '../../dist/calldata/mayan/fastMctpBridge.js';
import { readOft } from '../../dist/calldata/socket/protocols/oft.js';
import { resolveParsed } from '../../dist/calldata/resolve.js';
import { applyLifiIntentData } from '../../dist/calldata/lifi/params.js';

describe('receiver check policy', () => {
  const socket = readFixture('providers/socket/quote-v3.json');
  const relay = readFixture('providers/relay/quote-v2.json');
  const history = readFixture('regressions/history-success.json');
  const relayTransactions = [
    ...readFixture('providers/relay/lab.json').records.flatMap((record) => record.buildResponse ? [record.buildResponse] : []),
    readFixture('providers/relay/source-swap.json'),
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

describe('local receiver recovery without chain-state requests', () => {
  const user = '0x1111111111111111111111111111111111111111';
  const other = '0x2222222222222222222222222222222222222222';
  const token = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
  const wrapped = '0x4200000000000000000000000000000000000006';
  const zero = '0x0000000000000000000000000000000000000000';
  const handler = '0x0f7ae28de1c8532170ad4ee566b5801485c13a0e';
  const transfer = (asset, receiver, amount) => ({
    target: asset, data: '0xa9059cbb' + word(receiver) + word(amount), value: 0n,
  });
  const drain = (asset, receiver) => ({
    target: handler, data: '0xef8738d3' + word(asset) + word(receiver), value: 0n,
  });
  const message = (calls, fallback = zero) => {
    const encoded = calls.map((c) => word(c.target) + word(96) + word(c.value) + bytes(c.data));
    let offset = calls.length * 32;
    const offsets = encoded.map((c) => { const current = offset; offset += c.length / 2; return word(current); });
    return '0x' + word(32) + word(64) + word(fallback) + word(calls.length) + offsets.join('') + encoded.join('');
  };
  const across = (calls, fallback = zero, asset = token) => resolveParsed(applyAcrossMessage({
    aggregatorId: 'across', method: 'deposit', kind: 'bridge', sourceToken: asset,
    sourceAmount: 100n, destinationChainId: 8453n, receiver: handler,
    outputToken: asset, minOutputAmount: 100n,
  }, message(calls, fallback)));

  const dex = readFixture('quotes/routes/cases.json')
    .find((item) => item.id === 'discovery-across-destination-dex-5pct');

  test('Across real destination swap proves the same receiver for success and fallback without inventing one output asset', () => {
    const parsed = decodeBridgeCalldata('across', dex.tx);
    expect(parsed.receiver).toBe(dex.expected.receiver);
    expect(parsed.unresolvedFields).toEqual(['outputToken', 'minOutputAmount']);
    const check = validateBridgeCalldata('across', dex.chainKey, { ...dex.tx, from: undefined }, {
      ...dex.request, userAddress: other,
    });
    expect(check.errors.map((error) => error.error_code)).toContain('BRIDGE_RECEIVER_MISMATCH');
  });

  test('lightweight build accepts the proven Across receiver without reporting known output limits', async () => {
    const reports = [];
    await expect(buildTx('across', { ...dex.request, bridgeId: dex.bridgeId,
      toTokenRawAmount: dex.quoteBenchmark.quotedOutputAmount, onError: (report) => reports.push(report) },
    { buildBridgeTx: async () => dex.tx })).resolves.toBe(dex.tx);
    expect(reports).toEqual([]);
  });

  test('Across does not trust an unreviewed Settler, action or destination chain', () => {
    const settler = '7d6839415693801e94cdc4a7d732c9a3fdbbd1d7';
    const foreign = dex.tx.data.replaceAll(settler, other.slice(2));
    expect(decodeBridgeCalldata('across', { ...dex.tx, data: foreign }).receiver).toBeUndefined();
    const unknownAction = dex.tx.data.replace('38c9c147', 'deadbeef');
    expect(decodeBridgeCalldata('across', { ...dex.tx, data: unknownAction }).receiver).toBeUndefined();
    const wrongChain = dex.tx.data.slice(0, 10 + 6 * 64) + word(10) + dex.tx.data.slice(10 + 7 * 64);
    expect(decodeBridgeCalldata('across', { ...dex.tx, data: wrongChain }).receiver).toBeUndefined();
  });

  test('Eco retains one receiver across different payout assets without inventing a token or amount', () => {
    const result = readDestinationTransfers([transfer(token, user, 10n), transfer(wrapped, user, 20n)]);
    expect(result.receiver).toBe(user);
    expect(result.outputToken).toBeUndefined();
    expect(result.minOutputAmount).toBeUndefined();
  });

  test('Eco does not merge different recipients or ignore unknown calls', () => {
    expect(readDestinationTransfers([transfer(token, user, 10n), transfer(wrapped, other, 20n)]).receiver).toBeUndefined();
    expect(readDestinationTransfers([transfer(token, user, 10n), { target: other, data: '0x12345678', value: 0n }]).receiver).toBeUndefined();
  });

  test('Across decodes direct transfers and a fallback-only payout', () => {
    expect(across([transfer(token, user, 100n)])).toMatchObject({ receiver: user, outputToken: token, minOutputAmount: 100n });
    expect(across([], user)).toMatchObject({ receiver: user, outputToken: token, minOutputAmount: 100n });
    expect(across([transfer(token, user, 60n)], user)).toMatchObject({ receiver: user, outputToken: token, minOutputAmount: 100n });
  });

  test('Across retains the existing fee-and-drain behavior', () => {
    expect(across([transfer(token, other, 1n), drain(token, user)], user)).toMatchObject({
      receiver: user, outputToken: token, minOutputAmount: 99n,
    });
  });

  test('Across combines repeated drains to the same recipient', () => {
    expect(across([drain(token, user), drain(token, user)], user)).toMatchObject({
      receiver: user, outputToken: token, minOutputAmount: 100n,
    });
  });

  test('Across does not conceal a second direct recipient behind the fallback', () => {
    expect(across([transfer(token, other, 60n)], user).receiver).toBeUndefined();
    expect(across([transfer(token, user, 60n), transfer(token, other, 40n)]).receiver).toBeUndefined();
  });

  test('Across does not derive a receiver from stranded funds or arbitrary calls', () => {
    expect(across([transfer(token, user, 60n)]).receiver).toBeUndefined();
    expect(across([{ target: other, data: '0x12345678', value: 0n }], user).receiver).toBeUndefined();
  });

  test('Across preserves the receiver when success and fallback pay different assets', () => {
    const withdrawal = '0x2e1a7d4d' + word(0);
    const withdrawBytes = bytes(withdrawal);
    const data = '0xc41e8295' + word(wrapped) + word(128) + word(0) + word(128 + withdrawBytes.length / 2) +
      withdrawBytes + word(1) + word(wrapped) + word(4);
    const result = across([{ target: handler, data, value: 0n }, drain(zero, user)], user, wrapped);
    expect(result.receiver).toBe(user);
    expect(result.outputToken).toBeUndefined();
    expect(result.minOutputAmount).toBeUndefined();
    expect(result.unresolvedFields).toEqual(['outputToken', 'minOutputAmount']);
    const split = across([transfer(wrapped, user, 40n), { target: handler, data, value: 0n }, drain(zero, user)], zero, wrapped);
    expect(split.receiver).toBe(user);
    expect(split.outputToken).toBeUndefined();
    expect(split.minOutputAmount).toBeUndefined();
    expect(() => across([{ target: handler, data, value: 0n }, drain(zero, user)], other, wrapped)).toThrow('fallback recipient');
  });

  const fastBridge = (payloadType, payload) => '0xf58b6de8' + [token, 1000000, 0, 0, 0, user, 6, zero, 0,
    payloadType, 1000, 384].map(word).join('') + bytes(payload);

  test('FastMCTP type 1 ignores custom bytes, while type 2 remains unresolved even with empty bytes', () => {
    const ordinary = resolveParsed(decodeFastMctpBridge(fastBridge(1, '0x1234')));
    expect(ordinary).toMatchObject({ receiver: user, outputToken: token, minOutputAmount: 990000n });
    expect(ordinary.destinationCallData).toBeUndefined();
    for (const payload of ['0x', '0x1234']) {
      const custom = decodeFastMctpBridge(fastBridge(2, payload));
      expect(custom.receiver).toBeUndefined();
      expect(custom.destinationCallData).toBe(payload);
    }
    expect(() => decodeFastMctpBridge(fastBridge(3, '0x'))).toThrow('unsupported Mayan protocol calldata');
  });

  const oft = (command, compose = '0x') => {
    const extraBytes = bytes('0x'), composeBytes = bytes(compose);
    const tuple = [30184, user, 100, 99, 224, 224 + extraBytes.length / 2,
      224 + extraBytes.length / 2 + composeBytes.length / 2].map(word).join('') + extraBytes + composeBytes + bytes(command);
    return '0xc7c7f5b3' + [128, 0, 0, user].map(word).join('') + tuple;
  };

  test('OFT bus mode retains the receiver but does not guess remote token mappings', () => {
    const bus = readOft(oft('0x01'), other, token);
    expect(bus.receiver).toBe(user);
    expect(bus.outputToken).toBeUndefined();
    expect(bus.outputTokenReference.protocol).toBe('oft');
    expect(readOft(oft('0x01', '0x1234'), other, token).receiver).toBeUndefined();
    expect(readOft(oft('0x0102'), other, token).receiver).toBeUndefined();
  });

  const lifiDestination = (overrides = {}, swapOverrides = {}, chain = 8453n) => {
    const parsed = { aggregatorId: 'lifi', method: 'startBridgeTokensViaLiFiIntentEscrowV2',
      kind: 'bridge', sourceToken: token, sourceAmount: 100n, bridgeAmount: 100n, destinationChainId: chain };
    const data = {
      recipient: '0x' + word(user), outputToken: '0x' + word(token), outputAmountMultiplier: 10n ** 18n,
      dstCallReceiver: '0x' + word('0xe6ee2a573047598b2452a879f2188b31d0442dbf'),
      outputSettler: '0x' + word('0x75220b7600c300005038432a0000f308e0000068'),
      depositAndRefundAddress: user, nonce: 1n,
      dstCallSwapData: [{ callTo: token, approveTo: '0x4dac9d1769b9b304cb04741dcdeb2fc14abdf110',
        sendingAssetId: token, receivingAssetId: token, fromAmount: 100n, requiresDeposit: true,
        callData: transfer(token, user, 100n).data, ...swapOverrides }],
      ...overrides,
    };
    applyLifiIntentData(parsed, data);
    return resolveParsed(parsed);
  };

  test('LI.FI known ReceiverOIF transfer proves the final recipient and local output token', () => {
    expect(lifiDestination()).toMatchObject({ receiver: user, outputToken: token, minOutputAmount: 100n,
      bridgeReceiver: '0xe6ee2a573047598b2452a879f2188b31d0442dbf', unresolvedFields: [] });
  });

  test('LI.FI cannot forge ReceiverOIF identity, payout, input amount or refund recipient', () => {
    for (const parsed of [
      lifiDestination({ dstCallReceiver: '0x' + word(other) }),
      lifiDestination({ outputSettler: '0x' + word(other) }),
      lifiDestination({ depositAndRefundAddress: other }),
      lifiDestination({}, { approveTo: other }),
      lifiDestination({}, { callData: transfer(token, other, 100n).data }),
      lifiDestination({}, { callData: transfer(token, user, 101n).data }),
      lifiDestination({}, { callData: '0x12345678' }),
      lifiDestination({}, {}, 1n),
    ]) {
      expect(parsed.receiver).toBeUndefined();
      expect(parsed.outputToken).toBeUndefined();
      expect(parsed.unresolvedFields).toContain('receiver');
    }
  });
});

describe('refund beneficiaries are checked independently of the final receiver', () => {
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

  const intents = readFixture('onchain/lifi/lifiIntents.json');
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
    const native = readFixture(`onchain/socket/${bridgeId}.json`)
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
