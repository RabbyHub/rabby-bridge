import { describe, expect, test } from '@jest/globals';
import {
  BRIDGE_ERRORS, BridgeError, decodeBridgeCalldataResult, validateBridgeCalldata,
  getQuote, toBridgeErrorReport,
} from '../dist/index.js';
import { loadTransactions } from './calldata/load-transactions.js';

const wallet = '0x1234567890123456789012345678901234567890';
const hash = '0x' + 'ab'.repeat(32);
const secret = 'private@example.com';
const body = '0xdeadbeef' + wallet.slice(2).padStart(64, '0');
const intent = (item) => ({ userAddress: item.expected.receiver, fromTokenId: item.expected.sourceToken,
  fromTokenRawAmount: item.expected.sourceAmount, toChainId: item.toChainKey,
  toTokenId: item.expected.outputToken, toTokenRawAmount: item.expected.minOutputAmount, slippage: '0' });

describe('privacy-safe bridge diagnostics', () => {
  test('keeps an unknown selector and shape without retaining transaction arguments', () => {
    const result = decodeBridgeCalldataResult('across', { data: body, from: wallet, to: wallet, value: '123456789' });
    const report = toBridgeErrorReport(result);
    expect(report.errors[0]).toMatchObject({ error_code: BRIDGE_ERRORS.UNSUPPORTED_METHOD.error_code,
      aggregatorId: 'across', selector: '0xdeadbeef', calldataBytes: 36, calldataFormat: 'valid' });
    for (const value of [wallet, body, '123456789']) expect(JSON.stringify(report)).not.toContain(value);
    expect(toBridgeErrorReport({ ok: true, parsed: { receiver: wallet } })).toBeUndefined();
    expect(toBridgeErrorReport({ pass: true, routerPass: true, errors: [] })).toBeUndefined();
  });

  test('retains only boolean validation flags in observations that still pass the router', () => {
    const report = toBridgeErrorReport({ pass: true, errors: [{ ...BRIDGE_ERRORS.RECEIVER_MISMATCH,
      pass: true, routerPass: true, fromPass: true, toPass: false, receiverPass: false, blocking: false,
      receiver: wallet, amount: '123456789' }] });
    expect(report.errors[0]).toEqual({ ...BRIDGE_ERRORS.RECEIVER_MISMATCH,
      pass: true, routerPass: true, fromPass: true, toPass: false, receiverPass: false, blocking: false });
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
