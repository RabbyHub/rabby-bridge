import { readFileSync } from 'node:fs';
import { describe, expect, jest, test } from '@jest/globals';
import {
  BRIDGE_ERRORS,
  BridgeError,
  InvalidBridgeProviderError,
  buildTx,
  decodeBridgeCalldata,
  decodeBridgeCalldataResult,
  getBridgeRouter,
  getQuote,
  getQuoteListWithTx,
  validateBridgeCalldata,
  validateBridgeTx,
  toBridgeErrorReport,
} from '../dist/index.js';
import { expectCalldataError } from './helpers/assert-validation-error.js';
import { readMayanProtocol } from '../dist/calldata/mayan/readProtocol.js';
import { loadTransactions, fixtureIntent as intent } from './helpers/fixtures.js';

describe('structured bridge failures', () => {
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

  test('preserves the Relay order hash code in transaction validation', () => {
    const orderData = { ...relay.response.protocol.v2.orderData, salt: '1' };
    const error = expectCalldataError(() => validateBridgeTx('relay', relay.params.fromChainId, 'relay', relay.tx,
      { ...relay.params, orderData }));
    expect(error).toMatchObject({ error_code: BRIDGE_ERRORS.RELAY_ORDER_HASH_MISMATCH.error_code,
      stage: 'provider_response' });
  });

  test('preserves the exported provider error class and sanitized report', () => {
    const error = new InvalidBridgeProviderError('relay', 'private response');
    expect(error).toBeInstanceOf(BridgeError);
    expect(error.reason).toBe('private response');
    expect(error.toJSON()).toMatchObject({ name: 'InvalidBridgeProviderError',
      error_code: BRIDGE_ERRORS.INVALID_RESPONSE.error_code });
    expect(JSON.stringify(error.toJSON())).not.toContain('private response');
  });

  test('sanitizes backend exceptions', async () => {
    const error = await getQuote('relay', relay.params, {
      getBridgeQuoteListV2: async () => { throw new Error('secret response body'); },
    }).catch((error) => error);
    expect(error.error_code).toBe(BRIDGE_ERRORS.BACKEND_QUOTE_REQUEST_FAILED.error_code);
    expect(error.errors[0].requestKind).toBe('backend_quote');
    expect(JSON.stringify(error)).not.toContain('secret response body');
  });
});

describe('privacy-safe bridge diagnostics', () => {
  const wallet = '0x1234567890123456789012345678901234567890';
  const hash = '0x' + 'ab'.repeat(32);
  const secret = 'private@example.com';
  const body = '0xdeadbeef' + wallet.slice(2).padStart(64, '0');

  test('keeps an unknown selector and shape without retaining transaction arguments', () => {
    const result = decodeBridgeCalldataResult('across', { data: body, from: wallet, to: wallet, value: '123456789' });
    const report = toBridgeErrorReport(result);
    expect(report.errors[0]).toMatchObject({ error_code: BRIDGE_ERRORS.UNSUPPORTED_METHOD.error_code,
      aggregatorId: 'across', selector: '0xdeadbeef', calldataBytes: 36, calldataFormat: 'valid' });
    for (const value of [wallet, body, '123456789']) expect(JSON.stringify(report)).not.toContain(value);
    expect(toBridgeErrorReport({ ok: true, parsed: { receiver: wallet } })).toBeUndefined();
    expect(toBridgeErrorReport({ pass: true, routerPass: true, errors: [] })).toBeUndefined();
  });

  test('retains only boolean validation flags in failures that passed the router', () => {
    const report = toBridgeErrorReport({ pass: false, errors: [{ ...BRIDGE_ERRORS.RECEIVER_MISMATCH,
      pass: false, routerPass: true, fromPass: true, toPass: false, receiverPass: false, blocking: true, lite: true,
      receiver: wallet, amount: '123456789' }] });
    expect(report.errors[0]).toEqual({ ...BRIDGE_ERRORS.RECEIVER_MISMATCH,
      pass: false, routerPass: true, fromPass: true, toPass: false, receiverPass: false, blocking: true });
    const invalid = new BridgeError(BRIDGE_ERRORS.UNKNOWN, { pass: wallet, fromPass: secret, receiverPass: false }).toJSON();
    expect(invalid.errors[0]).toEqual({ ...BRIDGE_ERRORS.UNKNOWN, receiverPass: false });
  });

  test('retains a usable prefix for malformed calldata and gives ABI failure positions', () => {
    const malformed = toBridgeErrorReport(decodeBridgeCalldataResult('across', { data: '0xdeadbeef-not-hex' }));
    expect(malformed.errors[0]).toMatchObject({ selector: '0xdeadbeef', calldataFormat: 'invalid' });
    expect(malformed.errors[0]).not.toHaveProperty('calldataBytes');
    const truncated = toBridgeErrorReport(decodeBridgeCalldataResult('across', { data: '0xad5425c6' }));
    expect(truncated.errors[0]).toMatchObject({ error_code: BRIDGE_ERRORS.ABI_WORD_OUT_OF_BOUNDS.error_code,
      selector: '0xad5425c6', calldataBytes: 4, abiOffset: 352, abiBufferBytes: 0 });
  });

  test('keeps Socket outer/router/unknown-protocol selectors through structural rejection', () => {
    const item = loadTransactions('socket').find((entry) => entry.bridgeId === 'oft' && entry.tx.data.includes('c7c7f5b3'));
    const data = item.tx.data.replace('c7c7f5b3', 'deadbeef');
    const result = validateBridgeCalldata('socket', item.chainKey, { ...item.tx, data }, intent(item));
    expect(result.ok).toBe(false);
    const report = toBridgeErrorReport(result);
    expect(report.errors[0]).toMatchObject({ selector: '0x2213bc0b', protocolSelector: '0xdeadbeef' });
    expect(['0xb18248d5', '0x324012e2']).toContain(report.errors[0].routerSelector);
    expect(report.errors[0].protocolCalldataBytes).toBeGreaterThan(4);
    expect(JSON.stringify(report)).not.toContain(item.expected.receiver);
    expect(JSON.stringify(report)).not.toContain(data);
  });

  test('keeps an unknown Mayan inner selector rather than losing it in a partial decode', () => {
    const item = loadTransactions('mayan').find((entry) => entry.tx.data.includes('2337e236'));
    const result = validateBridgeCalldata('mayan', item.chainKey,
      { ...item.tx, data: item.tx.data.replace('2337e236', 'deadbeef') }, intent(item));
    expect(result.ok).toBe(false);
    expect(toBridgeErrorReport(result).errors[0]).toMatchObject({ protocolSelector: '0xdeadbeef', aggregatorId: 'mayan' });
  });

  test('whitelists context values, canonicalizes messages, and ignores injected fields on every conversion', () => {
    const error = new BridgeError(BRIDGE_ERRORS.FROM_TOKEN_MISMATCH, {
      aggregatorId: 'lifi', chainId: 'eth', toChainId: 'base', bridgeId: secret, method: wallet,
      selector: body, protocolSelector: hash, destinationSelectors: ['0xdeadbeef', wallet, body],
      unverifiedFields: ['outputToken', secret], wallet, amount: '123456789', txHash: hash,
      requestUrl: `https://example.com/?user=${wallet}`, rawResponse: { email: secret },
    });
    error.name = secret;
    error.errors[0].message = secret;
    error.errors[0].stage = wallet;
    error.errors[0].orderId = hash;
    error.errors[0].parsed = { receiver: wallet };
    const report = toBridgeErrorReport(error);
    expect(report.name).toBe('BridgeError');
    expect(report.errors[0]).toEqual({ ...BRIDGE_ERRORS.FROM_TOKEN_MISMATCH,
      aggregatorId: 'lifi', chainId: 'eth', toChainId: 'base', bridgeId: 'unknown',
      destinationSelectors: ['0xdeadbeef'], unverifiedFields: ['outputToken'] });
    for (const value of [wallet, hash, secret, body, '123456789']) expect(JSON.stringify(report)).not.toContain(value);
    expect(toBridgeErrorReport(new Error(secret)).error_code).toBe(BRIDGE_ERRORS.UNKNOWN.error_code);
  });

  test('backend error reporting retains only static request context', async () => {
    const error = await getQuote('socket', { userAddress: wallet, fromChainId: 'arb', fromTokenId: 'arb',
      fromTokenRawAmount: '1000000', toChainId: 'base', toTokenId: 'base', slippage: '0.01', feeRate: 0 },
      { getBridgeQuoteListV2: async () => { throw new Error(secret); } }).catch((error) => error);
    const report = toBridgeErrorReport(error);
    expect(report.errors[0]).toMatchObject({ requestKind: 'backend_quote', chainId: 'arb', toChainId: 'base' });
    expect(JSON.stringify(report)).not.toContain(wallet);
    expect(JSON.stringify(report)).not.toContain(secret);
  });
});
