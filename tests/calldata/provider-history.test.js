import { describe, expect, test } from '@jest/globals';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { loadProviderHistoryTransactions } from './load-transactions.js';
import { providerHistoryResponse, replayProviderHistory } from './provider-history.js';

const cases = loadProviderHistoryTransactions();
const tags = { relay: 'Relay', socket: 'Socket', layerswap: 'LiFi' };
describe('historical provider responses bound to source transactions', () => {
  test.each(cases)('$id keeps the unchanged captured provider response', (item) => {
    const body = readFileSync(new URL(`../fixtures/providers/history-20261103/${item.providerHistory.responseFile}`, import.meta.url));
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
