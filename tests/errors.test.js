import { readFileSync } from 'node:fs';
import { describe, expect, jest, test } from '@jest/globals';
import {
  BRIDGE_ERRORS, BridgeError, buildTx,
  decodeBridgeCalldata,
  decodeBridgeCalldataResult, getBridgeRouter, getQuote, getQuoteListWithTx, validateBridgeCalldata,
} from '../dist/index.js';
import { readRelayQuote, relayChains } from './helpers/providers/relay.js';
import { readMayanProtocol } from '../dist/calldata/mayan/readProtocol.js';
import { loadTransactions } from './helpers/fixtures.js';

const user = '0x1111111111111111111111111111111111111111';
const sourceToken = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const outputToken = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const other = '0x2222222222222222222222222222222222222222';
const tx = {
  to: getBridgeRouter('across', 'eth'), value: '0x0', chainId: 1,
  data: '0xea86bd46' + [user, user, sourceToken, outputToken, 10000000, 9900000, 8453, 0, 1800, 0, 352, 0]
    .map((value) => BigInt(value).toString(16).padStart(64, '0')).join(''),
};
const params = {
  userAddress: user, fromChainId: 'eth', fromTokenId: sourceToken, fromTokenRawAmount: '10000000',
  toChainId: 'base', toTokenId: outputToken, toTokenRawAmount: '9900000', slippage: '0', bridgeId: 'across',
};
const relay = JSON.parse(readFileSync(new URL('./fixtures/providers/relay/quote-v2.json', import.meta.url)));

describe('structured bridge failures', () => {
  test('codes are unique and serializable', () => {
    const definitions = Object.values(BRIDGE_ERRORS);
    expect(new Set(definitions.map((error) => error.error_code)).size).toBe(definitions.length);
    for (const definition of definitions) {
      expect(definition.error_code).toMatch(/^BRIDGE_[A-Z0-9_]+$/);
      expect(JSON.parse(JSON.stringify(new BridgeError(definition))).errors).toEqual([definition]);
    }
  });

  test('preserves the exact ABI failure through nullable decoding and build rejection', async () => {
    const truncated = { ...tx, data: '0xad5425c6' };
    const result = decodeBridgeCalldataResult('across', truncated);
    expect(result).toMatchObject({ ok: false, error_code: BRIDGE_ERRORS.ABI_WORD_OUT_OF_BOUNDS.error_code, stage: 'decode',
      errors: [expect.objectContaining({ ...BRIDGE_ERRORS.ABI_WORD_OUT_OF_BOUNDS,
        aggregatorId: 'across', method: 'deposit', selector: '0xad5425c6' })] });
    expect(decodeBridgeCalldata('across', truncated)).toBeNull();
    const onError = jest.fn();
    await expect(buildTx('across', { ...params, onError }, { buildBridgeTx: async () => truncated }))
      .rejects.toMatchObject({ error_code: BRIDGE_ERRORS.ABI_WORD_OUT_OF_BOUNDS.error_code });
    expect(onError.mock.calls[0][0]).toMatchObject({ error_code: BRIDGE_ERRORS.ABI_WORD_OUT_OF_BOUNDS.error_code,
      errors: expect.arrayContaining([expect.objectContaining({ operation: 'buildTx', chainId: 'eth',
        bridgeId: 'across', pass: false, routerPass: true, fromPass: false, blocking: true })]) });
  });

  test('keeps nested Mayan decoder details and does not mark deferred RPC checks as errors', () => {
    try {
      readMayanProtocol('0x2337e236');
      throw new Error('expected a decoding failure');
    } catch (error) {
      expect(error).toBeInstanceOf(BridgeError);
      expect(error.errors[0]).toMatchObject({
        error_code: BRIDGE_ERRORS.ABI_WORD_OUT_OF_BOUNDS.error_code, protocolSelector: '0x2337e236',
      });
    }
    const item = loadTransactions('socket').find((item) => item.bridgeId === 'oft');
    const check = validateBridgeCalldata('socket', item.chainKey, item.tx, {
      userAddress: item.expected.receiver, fromTokenId: item.expected.sourceToken,
      fromTokenRawAmount: item.expected.sourceAmount, toChainId: item.toChainKey,
      toTokenId: item.expected.outputToken, toTokenRawAmount: item.expected.minOutputAmount, slippage: '0',
    });
    expect(check.ok).toBe(true);
    expect(check.errors).toEqual([]);
    expect(check.error_code).toBeUndefined();
    expect(check.unverifiedFields).toEqual(['outputToken', 'minOutputAmount']);
  });

  test('collects every independent intent mismatch instead of only the first one', () => {
    const check = validateBridgeCalldata('across', 'eth', tx, {
      ...params, fromTokenId: other, fromTokenRawAmount: '1', toTokenId: other, toTokenRawAmount: '100000000',
    });
    expect(check.ok).toBe(false);
    expect(check.errors.map((error) => error.error_code)).toEqual([
      BRIDGE_ERRORS.FROM_TOKEN_MISMATCH.error_code, BRIDGE_ERRORS.FROM_AMOUNT_MISMATCH.error_code,
      BRIDGE_ERRORS.TO_TOKEN_MISMATCH.error_code, BRIDGE_ERRORS.MIN_RECEIVE_MISMATCH.error_code,
    ]);
    expect(check.reason).toBe('from_token,from_amount,to_token,min_receive');
    expect(check.error_code).toBe(check.errors[0].error_code);
  });

  test('reports both rejected quotes and rejected builds without changing list filtering', async () => {
    const onError = jest.fn();
    const api = {
      getBridgeQuoteListV2: async () => [
        { bridge_id: 'bad-spender', approve_contract_id: other },
        { bridge_id: 'bad-router', to_token_raw_amount_hex_str: '0x970fe0' },
      ],
      buildBridgeTx: async () => ({ ...tx, to: other }),
    };
    await expect(getQuoteListWithTx('across', { ...params, onError }, api)).resolves.toEqual([]);
    expect(onError.mock.calls.map(([report]) => report.error_code)).toEqual([
      BRIDGE_ERRORS.SPENDER_NOT_ALLOWED.error_code, BRIDGE_ERRORS.ROUTER_NOT_ALLOWED.error_code,
    ]);
    expect(onError.mock.calls[0][0].errors[0]).toMatchObject({ operation: 'getQuote', bridgeId: 'unknown' });
    expect(onError.mock.calls[1][0].errors[0]).toMatchObject({ operation: 'buildTx', bridgeId: 'unknown' });
    const report = JSON.stringify(onError.mock.calls);
    expect(report).not.toContain(user);
    expect(report).not.toContain(other);
    await expect(getQuoteListWithTx('across', { ...params, onError: () => { throw new Error('reporter failed'); } }, api))
      .resolves.toEqual([]);
  });

  test('preserves the Relay order hash code in offline evidence verification', () => {
    const response = structuredClone(relay.response);
    response.protocol.v2.orderId = '0x' + '11'.repeat(32);
    try {
      readRelayQuote(response, relay.params, relayChains(relay.chains));
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toMatchObject({ error_code: BRIDGE_ERRORS.RELAY_ORDER_HASH_MISMATCH.error_code,
        stage: 'provider_response' });
    }
  });

  test('sanitizes backend exceptions after removing direct-provider transports', async () => {
    const error = await getQuote('relay', relay.params, {
      getBridgeQuoteListV2: async () => { throw new Error('secret response body'); },
    }).catch((error) => error);
    expect(error.error_code).toBe(BRIDGE_ERRORS.BACKEND_QUOTE_REQUEST_FAILED.error_code);
    expect(error.errors[0].requestKind).toBe('backend_quote');
    expect(JSON.stringify(error)).not.toContain('secret response body');
  });
});
