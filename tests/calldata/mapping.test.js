import { describe, expect, test } from '@jest/globals';
import { decodeBridgeCalldata, validateBridgeCalldata } from '../../dist/index.js';
import { loadTransactions } from '../helpers/fixtures.js';

const transactions = loadTransactions();
const deferred = [
  ['lifi', 'superset', ['outputToken']],
  ['lifi', 'polygon', ['outputToken']],
  ['lifi', 'celercircle', ['minOutputAmount']],
  ['lifi', 'celercirclefast', ['minOutputAmount']],
  ['socket', 'ccip', ['outputToken', 'minOutputAmount']],
  ['socket', 'oft', ['outputToken', 'minOutputAmount']],
].map(([aggregator, bridge, fields]) => [aggregator, bridge, fields,
  transactions.find((item) => item.aggregatorId === aggregator && item.bridgeId === bridge)]);

const intent = (item) => ({
  userAddress: item.expected.receiver, fromTokenId: item.expected.sourceToken,
  fromTokenRawAmount: item.expected.sourceAmount, toChainId: item.toChainKey,
  toTokenId: item.expected.outputToken, toTokenRawAmount: item.expected.minOutputAmount, slippage: '0',
});

describe('deferred chain-state output fields', () => {
  test.each(deferred)('[%s] %s reports unavailable output checks without resolving them', (aggregator, bridge, fields, item) => {
    const check = validateBridgeCalldata(aggregator, item.chainKey, item.tx, intent(item));
    expect(check.ok).toBe(true);
    expect(check.unverifiedFields).toEqual(fields);
    expect(check.parsed.unresolvedFields).toEqual(fields);
    for (const field of fields) expect(check.parsed[field]).toBeUndefined();
    expect(check.parsed.sourceToken).toBe(item.expected.sourceToken);
    expect(check.parsed.sourceAmount).toBe(BigInt(item.expected.sourceAmount));
    expect(check.parsed.receiver).toBe(item.expected.receiver);
  });

  test('[LiFi] still rejects a wrong locally mapped CCTP output token', () => {
    const item = transactions.find((item) => item.bridgeId === 'celercircle');
    const check = validateBridgeCalldata('lifi', item.chainKey, item.tx, {
      ...intent(item), toTokenId: '0xdead000000000000000000000000000000000000',
    });
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('to_token');
    expect(check.unverifiedFields).toEqual(['minOutputAmount']);
  });

  test('[Mayan] leaves an ERC20 order minimum unresolved instead of using the quote amount', () => {
    const item = transactions.find((item) => item.id === 'gap-mayan-9eb0918f56c5ea7e042a58124904ed542811727c9c58e0ee6606c156e914ba1f');
    const check = validateBridgeCalldata('mayan', item.chainKey, item.tx, { ...intent(item), toTokenRawAmount: '1' });
    expect(check.ok).toBe(true);
    expect(check.parsed.outputToken).toBe(item.expected.outputToken);
    expect(check.parsed.minOutputAmount).toBeUndefined();
    expect(check.unverifiedFields).toEqual(['minOutputAmount']);
  });

  test('[LiFi] accepts transaction input as calldata', () => {
    const item = transactions.find((item) => item.aggregatorId === 'lifi');
    const parsed = decodeBridgeCalldata('lifi', { ...item.tx, data: undefined, input: item.tx.data });
    expect(parsed).toEqual(decodeBridgeCalldata('lifi', item.tx));
  });
});
