import { describe, expect, jest, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { buildTx, decodeBridgeCalldata, getQuoteListWithTx, validateBridgeCalldata, validateBridgeTx } from '../../dist/index.js';

const read = (file) => JSON.parse(readFileSync(new URL(`../fixtures/${file}`, import.meta.url)));
const socket = read('providers/socket-v3-20261103.json');
const relay = read('providers/relay-v2-20261103.json');
const otherId = '0x' + '12'.repeat(32);
const key = (id) => ({ quote_id: `${id}:cache-selection` });
const codes = (result) => result.errors.map((error) => error.error_code);
const flags = ({ pass, routerPass, fromPass, toPass, receiverPass }) => ({ pass, routerPass, fromPass, toPass, receiverPass });
const replaceId = (tx, before, after) => ({ ...tx, data: tx.data.replaceAll(before.slice(2), after.slice(2)) });
const rfq = socket.cases.find((item) => item.bridgeId === 'rfq-vault-executor');
const socketId = (item) => socket.response.result.routes.find((route) =>
  route.routeDetails.bridgeDetails.protocol.name === item.bridgeId).quoteId;

describe('local selected-quote identifier binding', () => {
  test.each(socket.cases)('binds Socket $bridgeId to its separately captured provider quote ID', (item) => {
    const intent = { ...socket.params, quoteKey: key(socketId(item)) };
    expect(validateBridgeCalldata('socket', item.chainKey, item.tx, intent).errors).toEqual([]);
    const baseline = validateBridgeTx('socket', item.chainKey, item.bridgeId, item.tx, intent);
    const changed = validateBridgeTx('socket', item.chainKey, item.bridgeId, item.tx, { ...intent, quoteKey: key(otherId) });
    expect(codes(changed)).toEqual(['BRIDGE_QUOTE_ID_MISMATCH']);
    expect(flags(changed)).toEqual(flags(baseline));
    expect(changed.fromPass).toBe(true);
    expect(changed.errors[0]).toMatchObject({ pass: true, routerPass: true, blocking: false });
  });

  test('accepts serialized keys and case differences without comparing the cache suffix', () => {
    const quoteId = socketId(rfq);
    const intent = { ...socket.params, quoteKey: JSON.stringify({ quote_id: `${quoteId.toUpperCase()}:another-cache` }) };
    expect(validateBridgeCalldata('socket', rfq.chainKey, rfq.tx, intent).errors).toEqual([]);
  });

  test.each([undefined, {}, { quote_id: 'legacy-cache-uuid' }, 'invalid-json', '[]'])(
    'silently skips a missing or unrecognized expected ID: %j', (quoteKey) => {
      expect(validateBridgeCalldata('socket', rfq.chainKey, rfq.tx, { ...socket.params, quoteKey }).errors).toEqual([]);
    }
  );

  test('compares the RFQ outer and vault quote IDs even without a selected quote key', () => {
    const parsed = decodeBridgeCalldata('socket', rfq.tx);
    const vaultCall = '823b01f9' + parsed.orderId.slice(2);
    expect(rfq.tx.data).toContain(vaultCall);
    const changed = { ...rfq.tx, data: rfq.tx.data.replace(vaultCall, '823b01f9' + otherId.slice(2)) };
    expect(codes(validateBridgeCalldata('socket', rfq.chainKey, changed, socket.params)))
      .toEqual(['BRIDGE_SOCKET_RFQ_QUOTE_ID_MISMATCH']);
    const baseline = validateBridgeTx('socket', rfq.chainKey, rfq.bridgeId, rfq.tx, socket.params);
    const result = validateBridgeTx('socket', rfq.chainKey, rfq.bridgeId, changed, socket.params);
    expect(flags(result)).toEqual(flags(baseline));
  });

  test('does not compare the Relay depository order hash with the quote request ID', () => {
    expect(relay.response.requestId).not.toBe(relay.expected.orderId);
    expect(validateBridgeCalldata('relay', relay.params.fromChainId, relay.tx,
      { ...relay.params, quoteKey: key(relay.response.requestId) }).errors).toEqual([]);
  });

  test('snapshots the selected key before the backend await and reports without exposing IDs', async () => {
    const quoteId = socketId(rfq);
    const quoteKey = key(quoteId);
    const tx = replaceId(rfq.tx, quoteId, otherId);
    const onError = jest.fn();
    const api = { buildBridgeTx: jest.fn(async () => {
      quoteKey.quote_id = `${otherId}:replaced-selection`;
      return tx;
    }) };
    await expect(buildTx('socket', { ...socket.params, bridgeId: rfq.bridgeId, quoteKey, onError }, api)).resolves.toBe(tx);
    expect(api.buildBridgeTx.mock.calls[0][0].quote_key).toBe(JSON.stringify(key(quoteId)));
    expect(onError.mock.calls[0][0].errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ error_code: 'BRIDGE_QUOTE_ID_MISMATCH', blocking: false, fromPass: true }),
    ]));
    const report = JSON.stringify(onError.mock.calls);
    for (const value of [quoteId, otherId, 'cache-selection', 'replaced-selection', tx.data]) expect(report).not.toContain(value);
  });

  test('forwards quote IDs from quote-list builds while retaining the original transaction', async () => {
    const onError = jest.fn();
    const quote = { bridge_id: rfq.bridgeId, quote_key: key(otherId) };
    const api = { getBridgeQuoteListV2: async () => [quote], buildBridgeTx: async () => rfq.tx };
    await expect(getQuoteListWithTx('socket', { ...socket.params, onError }, api)).resolves.toEqual([{ ...quote, tx: rfq.tx }]);
    expect(onError.mock.calls[0][0].errors[0].error_code).toBe('BRIDGE_QUOTE_ID_MISMATCH');
  });

  test('does not bind the legacy fresh quote+tx API to an unused selection key', async () => {
    const onError = jest.fn();
    await expect(buildTx('socket', { ...socket.params, bridgeId: rfq.bridgeId, quoteKey: key(otherId), onError },
      { getBridgeQuoteTxV2: async () => ({ tx: rfq.tx }) })).resolves.toBe(rfq.tx);
    expect(onError).not.toHaveBeenCalled();
  });
});
