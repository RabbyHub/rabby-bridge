import { readFileSync } from 'node:fs';
import { describe, expect, jest, test } from '@jest/globals';
import * as sdk from '../dist/index.js';
import { readRelayQuote, relayChains } from '../dist/providers/relay.js';
import { readSocketQuote, socketBridgeId } from '../dist/providers/socket.js';
import { verifyLayerSwapRecord } from './helpers/provider-offline.js';

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/providers/${name}.json`, import.meta.url)));
const relay = load('relay/quote-v2'), socket = load('socket/quote-v3'), layer = load('layerswap/pending');
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
    const providerClient = { getQuotes: jest.fn(), buildTx: jest.fn(), verifyTx: jest.fn(), verifyLayerSwapTx: jest.fn(), captureContext: jest.fn() };
    const quote = { bridge_id: params.bridgeId, quote_key: { quote_id: 'backend-selection' } };
    const api = { getBridgeQuoteListV2: jest.fn(async () => [quote]), buildBridgeTx: jest.fn(async () => tx) };
    await expect(sdk.getQuoteListWithTx(aggregator, { ...params, providerClient, onError }, api)).resolves.toEqual([{ ...quote, tx }]);
    expect(api.getBridgeQuoteListV2).toHaveBeenCalledTimes(1);
    expect(api.buildBridgeTx).toHaveBeenCalledTimes(1);
    for (const fn of Object.values(providerClient)) expect(fn).not.toHaveBeenCalled();
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

  test('preserves local LayerSwap value and Relay depositor checks after removing clients', async () => {
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
  test('Relay retains order-hash verification and catches altered recipients', () => {
    expect(readRelayQuote(relay.response, relay.params, relayChains(relay.chains)).parsed.receiver).toBe(relay.expected.receiver);
    const bad = structuredClone(relay.response);
    bad.protocol.v2.orderData.output.payments[0].recipient = other;
    expect(() => readRelayQuote(bad, relay.params, relayChains(relay.chains))).toThrow();
  });

  test.each(socket.cases)('Socket $bridgeId retains captured quotation validation', (item) => {
    const result = socket.response.result;
    const route = result.routes.find((row) => row.routeDetails.bridgeDetails &&
      socketBridgeId(row.routeDetails.bridgeDetails.protocol.name) === item.bridgeId);
    expect(readSocketQuote(result, route, socket.params).parsed.receiver).toBe(item.expected.receiver);
    expect(() => readSocketQuote({ ...result, receiverAddress: other }, route, socket.params)).toThrow();
  });

  test('Socket accepts spending less than requested but still binds calldata to its quote', () => {
    const result = socket.response.result;
    const route = result.routes.find((row) => socketBridgeId(row.routeDetails.bridgeDetails?.protocol.name) === 'rfq-vault-executor');
    const params = { ...socket.params, fromTokenRawAmount: (BigInt(socket.params.fromTokenRawAmount) * 2n).toString() };
    expect(readSocketQuote(result, route, params).parsed.sourceAmount).toBe(BigInt(result.input.amount));
    const changed = { ...result, input: { ...result.input, amount: (BigInt(result.input.amount) - 1n).toString() } };
    expect(() => readSocketQuote(changed, route, params)).toThrow('Socket source quote mismatch');
  });

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
