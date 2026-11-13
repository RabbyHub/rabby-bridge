import { word, bytes } from '../helpers/calldata.js';
import { readFixture } from '../helpers/fixtures.js';
import { describe, expect, test } from '@jest/globals';
import { buildTx, decodeBridgeCalldata, validateBridgeCalldata } from '../../dist/index.js';
import { applyAcrossMessage, readDestinationTransfers } from '../../dist/calldata/destination.js';
import { decodeFastMctpBridge } from '../../dist/calldata/mayan/fastMctpBridge.js';
import { readOft } from '../../dist/calldata/socket/protocols/oft.js';
import { resolveParsed } from '../../dist/calldata/resolve.js';
import { applyLifiIntentData } from '../../dist/calldata/lifi/params.js';

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

describe('local receiver recovery without chain-state requests', () => {
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
