import { readFixture, loadProviderHistoryTransactions } from './helpers/fixtures.js';
import { describe, expect, jest, test } from '@jest/globals';
import * as sdk from '../dist/index.js';
import { verifyLayerSwapRecord } from './helpers/layerswap.js';
import { createHash } from 'node:crypto';
import { providerHistoryBody, providerHistoryResponse, replayProviderHistory } from './helpers/history.js';

const relay = readFixture('providers/relay/quote-v2.json'), socket = readFixture('providers/socket/quote-v3.json'), layer = readFixture('providers/layerswap/pending.json');
const other = '0x1111111111111111111111111111111111111111';
const layerParams = { userAddress: layer.tx.from, fromChainId: 'eth', fromTokenId: layer.expected.sourceToken,
  fromTokenRawAmount: layer.expected.sourceAmount, toChainId: 'arb', toTokenId: layer.expected.outputToken,
  toTokenRawAmount: layer.expected.expectedOutputAmount, slippage: '0.01', bridgeId: 'layerswap' };

describe('backend-only lightweight entry points', () => {
  test('does not export provider request clients or fetch adapters', () => {
    for (const key of ['createBridgeProviderClient', 'createBridgeFetchRequest', 'BRIDGE_PROVIDER_ORIGINS', 'isDirectBridgeProviderRoute']) {
      expect(sdk).not.toHaveProperty(key);
    }
  });

  const cases = [
    ['relay', { ...relay.params, bridgeId: 'relay', allowMissingRelayOrder: true }, relay.tx],
    ...socket.cases.map((item) => ['socket', { ...socket.params, bridgeId: item.bridgeId }, item.tx]),
    ['lifi', layerParams, layer.tx],
  ];
  test.each(cases)('%s uses the backend selection and silently retains known unavailable fields', async (aggregator, params, tx) => {
    const onError = jest.fn();
    const quote = { bridge_id: params.bridgeId, quote_key: { quote_id: 'backend-selection' } };
    const api = { getBridgeQuoteListV2: jest.fn(async () => [quote]), buildBridgeTx: jest.fn(async () => tx) };
    await expect(sdk.getQuoteListWithTx(aggregator, { ...params, onError }, api)).resolves.toEqual([{ ...quote, tx }]);
    expect(api.getBridgeQuoteListV2).toHaveBeenCalledTimes(1);
    expect(api.buildBridgeTx).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    const check = sdk.validateBridgeCalldata(aggregator, params.fromChainId, tx, params);
    expect(check.unverifiedFields).toContain('minOutputAmount');
    if (aggregator !== 'lifi') expect(check.unverifiedFields).toContain('receiver');
  });

  test.each(cases)('%s rejects a locally known source token mismatch', async (aggregator, params, tx) => {
    const onError = jest.fn();
    await expect(sdk.buildTx(aggregator, { ...params, fromTokenId: other, onError }, { buildBridgeTx: async () => tx }))
      .rejects.toBeInstanceOf(sdk.InvalidBridgeCalldataError);
    expect(onError.mock.calls.flatMap(([report]) => report.errors)).toEqual(expect.arrayContaining([
      expect.objectContaining({ error_code: 'BRIDGE_FROM_TOKEN_MISMATCH', pass: false, fromPass: false, blocking: true }),
    ]));
  });

  test('keeps local CCTP destination-token validation while skipping its external receiver', async () => {
    const item = socket.cases.find((item) => item.bridgeId === 'cctp-v2');
    const onError = jest.fn();
    await expect(sdk.buildTx('socket', { ...socket.params, bridgeId: item.bridgeId, toTokenId: other, onError }, { buildBridgeTx: async () => item.tx }))
      .rejects.toBeInstanceOf(sdk.InvalidBridgeCalldataError);
    expect(onError.mock.calls.flatMap(([report]) => report.errors)).toEqual(expect.arrayContaining([
      expect.objectContaining({ error_code: 'BRIDGE_TO_TOKEN_MISMATCH', pass: false, toPass: false, receiverPass: false, blocking: true }),
    ]));
  });

  test('keeps LayerSwap receiver comparison without querying its order', async () => {
    const onError = jest.fn();
    const tx = { ...layer.tx, from: other };
    await expect(sdk.buildTx('lifi', { ...layerParams, userAddress: other, onError }, { buildBridgeTx: async () => tx }))
      .rejects.toBeInstanceOf(sdk.InvalidBridgeCalldataError);
    expect(onError.mock.calls.flatMap(([report]) => report.errors)).toEqual(expect.arrayContaining([
      expect.objectContaining({ error_code: 'BRIDGE_RECEIVER_MISMATCH', pass: false, receiverPass: false, blocking: true }),
    ]));
  });

  test('checks LayerSwap value and Relay depositor independently', async () => {
    const onError = jest.fn();
    await expect(sdk.buildTx('lifi', { ...layerParams, onError }, {
      buildBridgeTx: async () => ({ ...layer.tx, value: (BigInt(layer.tx.value) + 1n).toString() }),
    })).rejects.toBeInstanceOf(sdk.InvalidBridgeCalldataError);
    const depositor = other.slice(2).padStart(64, '0');
    const tx = { ...relay.tx, data: relay.tx.data.slice(0, 10) + depositor + relay.tx.data.slice(74) };
    await expect(sdk.buildTx('relay', { ...relay.params, bridgeId: 'relay', onError }, { buildBridgeTx: async () => tx }))
      .rejects.toBeInstanceOf(sdk.InvalidBridgeCalldataError);
    expect(onError.mock.calls.flatMap(([report]) => report.errors)).toEqual(expect.arrayContaining([
      expect.objectContaining({ error_code: 'BRIDGE_LAYERSWAP_SOURCE_VALUE_MISMATCH', fromPass: false, blocking: true }),
      expect.objectContaining({ error_code: 'BRIDGE_DEPOSITOR_MISMATCH', fromPass: false, blocking: true }),
    ]));
  });

  test('reports incomplete Relay source fields without claiming that they passed', async () => {
    const word = (n) => BigInt(n).toString(16).padStart(64, '0');
    const tx = { ...relay.tx, value: '0x0', data: '0xcd6e13f7' + [128, relay.params.userAddress, 0, 160, 0, 32, 1].map(word).join('') };
    const onError = jest.fn();
    await expect(sdk.buildTx('relay', { ...relay.params, bridgeId: 'relay', onError }, { buildBridgeTx: async () => tx }))
      .rejects.toBeInstanceOf(sdk.InvalidBridgeCalldataError);
    expect(onError.mock.calls.flatMap(([report]) => report.errors)).toEqual(expect.arrayContaining([
      expect.objectContaining({ error_code: 'BRIDGE_UNVERIFIED_BRIDGE_FIELDS', pass: false, fromPass: false,
        unverifiedFields: expect.arrayContaining(['sourceToken', 'sourceAmount']), blocking: true }),
    ]));
  });
});

describe('captured provider evidence remains verifiable offline', () => {
  test('LayerSwap captured records retain their fixed destination expectations', () => {
    const checked = verifyLayerSwapRecord(layerParams, layer.tx, layer.providerResponse);
    expect(checked.parsed.receiver).toBe(layer.expected.receiver);
    expect(checked.parsed.minOutputAmount).toBe(BigInt(layer.expected.minOutputAmount));
    const bad = structuredClone(layer.providerResponse);
    bad.data[0].swap.destination_address = other;
    expect(() => verifyLayerSwapRecord(layerParams, layer.tx, bad)).toThrow();
  });

  test('LayerSwap accepts spending less than the local request', () => {
    const params = { ...layerParams, fromTokenRawAmount: (BigInt(layerParams.fromTokenRawAmount) * 2n).toString() };
    expect(verifyLayerSwapRecord(params, layer.tx, layer.providerResponse).parsed.sourceAmount)
      .toBe(BigInt(layerParams.fromTokenRawAmount));
  });
});

describe('historical provider responses bound to source transactions', () => {
  const cases = loadProviderHistoryTransactions();
  const tags = { relay: 'Relay', socket: 'Socket', layerswap: 'LiFi' };

  test.each(cases)('$id keeps the unchanged captured provider response', (item) => {
    const body = providerHistoryBody(item);
    expect(createHash('sha256').update(body).digest('hex')).toBe(item.providerHistory.sha256);
  });
  test.each(cases.filter((item) => !item.expectedValidationError).map((item) => [tags[item.providerHistory.provider], item.id, item]))(
    '[%s] %s matches all five independent fixed expectations', async (_, id, item) => {
    const parsed = await replayProviderHistory(item);
    for (const field of ['sourceToken', 'outputToken', 'receiver']) expect(parsed[field]).toBe(item.expected[field]);
    for (const field of ['sourceAmount', 'minOutputAmount', 'destinationChainId']) expect(parsed[field]).toBe(BigInt(item.expected[field]));
    expect(parsed.unresolvedFields).toEqual([]);
    });

  test.each(cases.filter((item) => item.expectedValidationError).map((item) => [tags[item.providerHistory.provider], item.id, item]))(
    '[%s] %s preserves a known fail-closed rejection', async (_, id, item) => {
      await expect(replayProviderHistory(item)).rejects.toThrow(item.expectedValidationError);
    });

  test('[Relay] rejects changing a hashed destination condition', async () => {
    const item = cases.find((item) => item.providerHistory.provider === 'relay');
    const raw = providerHistoryResponse(item);
    raw.requests[0].orderData.output.payments[0].minimumAmount = '1';
    await expect(replayProviderHistory(item, raw)).rejects.toThrow();
  });

  test('[Relay] rejects changing source calldata while keeping its transaction reference', async () => {
    const item = cases.find((item) => item.providerHistory.provider === 'relay');
    await expect(replayProviderHistory({ ...item, tx: { ...item.tx, data: item.tx.data + '00' } })).rejects.toThrow();
  });

  test('[Socket] rejects associating a stored quote with a different source transaction', async () => {
    const item = cases.find((item) => item.providerHistory.provider === 'socket');
    const raw = providerHistoryResponse(item);
    raw.result.quoteDetails.row.srcTxHash = '0x' + '00'.repeat(32);
    await expect(replayProviderHistory(item, raw)).rejects.toThrow();
  });

  test.each(['relay', 'socket'])('%s rejects missing original order data instead of using actual delivery', async (provider) => {
    const item = cases.find((item) => item.providerHistory.provider === provider);
    const raw = providerHistoryResponse(item);
    if (provider === 'relay') delete raw.requests[0].orderData;
    else delete raw.result.quoteDetails;
    await expect(replayProviderHistory(item, raw)).rejects.toThrow();
  });
});
