import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { decodeBridgeCalldata } from '../../dist/index.js';
import { loadBridgeCases, loadQuoteTransactions, loadTransactions, manifest } from '../helpers/fixtures.js';

const transactions = loadTransactions();
const completeCases = loadBridgeCases();
const TAGS = {
  across: 'Across',
  lifi: 'LiFi',
  mayan: 'Mayan',
  relay: 'Relay',
  socket: 'Socket',
};

describe('onchain bridge fixture integrity', () => {
  test('retains only complete transactions with five explicit expected fields', () => {
    expect(transactions).toHaveLength(154);
    expect(manifest.sampleCount).toBe(154);
    expect(manifest.bridgeTypeCount).toBe(21);
    expect(completeCases).toHaveLength(348);
    expect(manifest.completeUnitCount).toBe(348);
    expect(new Set(completeCases.map((item) => item.id)).size).toBe(348);
    expect(new Set(completeCases.map((item) => `${item.chainKey}:${item.tx.to.toLowerCase()}:${item.tx.data.toLowerCase()}:${BigInt(item.tx.value)}`)).size).toBe(348);
    expect(new Set(completeCases.map((item) => `${item.aggregatorId}:${item.bridgeId}`)).size).toBe(29);
    expect(manifest.aggregators).toEqual({ lifi: 35, mayan: 16, socket: 29, across: 74 });
    for (const [aggregatorId, count] of Object.entries(manifest.aggregators)) {
      expect(loadTransactions(aggregatorId)).toHaveLength(count);
    }
    expect(transactions.filter((item) => item.quote !== null)).toHaveLength(154);
    expect(transactions.filter((item) => item.quote?.status === 'pending')).toHaveLength(manifest.quoteStatuses.pending ?? 0);
  });

  test('tracks every positive fixture function instead of silently counting only the old baseline', () => {
    const baseline = JSON.parse(readFileSync(new URL('../fixtures/coverage/baseline.json', import.meta.url)));
    const known = new Set(baseline.paths.map((item) => `${item.aggregatorId}:${item.bridgeId}:${item.method}`));
    const observed = new Set(completeCases.filter((item) => !item.expectedValidationError).map((item) => {
      const parsed = decodeBridgeCalldata(item.aggregatorId, item.tx);
      const key = `${item.aggregatorId}:${item.bridgeId}:${parsed.method} / ${parsed.protocolMethod || '-'}`;
      expect(known.has(key)).toBe(true);
      return key;
    }));
    expect(observed.size).toBe(baseline.functionPaths);
    expect(loadQuoteTransactions()).toHaveLength(manifest.quoteUnitCount);
  });

  test('retains all completed-history units and identifies the strict minimum rejection', () => {
    const completed = completeCases.filter((item) => item.sourceFile === 'bridge_history_completed_2026_11_03.csv');
    expect(completed).toHaveLength(48);
    expect(completed.filter((item) => item.providerHistory)).toHaveLength(20);
    expect(completed.filter((item) => item.expectedValidationError).map((item) => item.csvRow)).toEqual([30]);
  });

  test('retains the twenty previously uncovered function paths as positive units', () => {
    const completed = completeCases.filter((item) => item.regressionGroup === 'remaining-20-paths-20261103');
    expect(completed).toHaveLength(20);
    expect(completed.filter((item) => item.expectedValidationError)).toHaveLength(0);
    expect(new Set(completed.map((item) => `${item.aggregatorId}:${item.bridgeId}:${item.path}`)).size).toBe(20);
  });

  test.each(loadQuoteTransactions())('$id preserves the original request and exact quote amount', (item) => {
    expect(item.tx.from.toLowerCase()).toBe(item.request.userAddress.toLowerCase());
    expect(item.expected.receiver).toBe(item.request.userAddress.toLowerCase());
    expect(item.expected.sourceAmount).toBe(item.request.fromTokenRawAmount);
    expect(BigInt(item.quoteBenchmark.quotedOutputAmount)).toBe(BigInt(item.quote.to_token_raw_amount_hex_str));
    expect(item.quoteBenchmark.slippage).toBe(item.request.slippage);
    const slippageBps = BigInt(Math.round(Number(item.request.slippage) * 10000));
    expect(BigInt(item.quoteBenchmark.minimumThreshold)).toBe(BigInt(item.quoteBenchmark.quotedOutputAmount) * (10000n - slippageBps) / 10000n);
  });

  test.each(completeCases.map((item) => [TAGS[item.aggregatorId], item.id, item]))(
    '[%s] %s has source calldata and a complete five-field expectation', (tag, id, item) => {
      expect(item.tx.from).toMatch(/^0x[0-9a-f]{40}$/i);
      expect(item.tx.to).toMatch(/^0x[0-9a-f]{40}$/i);
      expect(item.tx.data).toMatch(/^0x(?:[0-9a-f]{2}){4,}$/i);
      expect(BigInt(item.tx.value)).toBeGreaterThanOrEqual(0n);
      for (const field of ['sourceToken', 'outputToken', 'receiver']) {
        expect(item.expected[field]).toMatch(/^0x[0-9a-f]{40}$/i);
      }
      for (const field of ['sourceAmount', 'minOutputAmount']) {
        expect(item.expected[field]).toMatch(/^\d+$/);
        expect(BigInt(item.expected[field])).toBeGreaterThan(0n);
      }
    }
  );

  test.each(transactions.map((item) => [TAGS[item.aggregatorId], item.id, item]))(
    '[%s] %s retains its transaction and quote references',
    (tag, id, item) => {
      expect(TAGS[item.aggregatorId]).toBe(tag);
      expect(item.id).toBe(id);
      expect(item.txHash).toMatch(/^0x[0-9a-f]{64}$/i);
      expect(item.tx.from).toMatch(/^0x[0-9a-f]{40}$/i);
      expect(item.tx.to).toMatch(/^0x[0-9a-f]{40}$/i);
      expect(item.tx.data).toMatch(/^0x(?:[0-9a-f]{2}){4,}$/i);
      expect(item.selector).toBe(item.tx.data.slice(0, 10).toLowerCase());
      expect(BigInt(item.tx.value)).toBeGreaterThanOrEqual(0n);
      expect(item.route).toBe(`${item.chainKey} -> ${item.toChainKey}`);
      expect(item.quote.aggregator.id).toBe(item.aggregatorId);
      expect(item.quote.bridge.id).toBe(item.bridgeId);
      expect(item.quote.from_token.chain).toBe(item.chainKey);
      expect(item.quote.to_token.chain).toBe(item.toChainKey);
      expect(item.quote.from_tx.tx_id.toLowerCase()).toBe(item.txHash.toLowerCase());
      for (const section of [item.quote.quote, item.quote.actual]) {
        for (const amount of Object.values(section)) {
          if (amount !== null) expect(amount).toMatch(/^\d+(?:\.\d+)?$/);
        }
      }
    }
  );
});
