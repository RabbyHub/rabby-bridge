import { describe, expect, test } from '@jest/globals';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { buildTx, decodeBridgeCalldata, validateBridgeCalldata } from '../../dist/index.js';
import { loadQuoteTransactions } from './load-transactions.js';
const cases = loadQuoteTransactions().filter((item) => item.regressionGroup === 'route-reachability-20261104');
const native = cases.find((item) => item.id === 'discovery-across-native-zero-fee');
const input = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const output = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const user = native.tx.from;
const word = (value) => BigInt(value).toString(16).padStart(64, '0');
const direct = (selector, extra, sending = input, destination = 8453) => ({
  from: user, to: '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae', value: '0x0', chainId: 1,
  data: selector + [32 * (1 + extra.length), ...extra, 1, 320, 352, 0, sending, user,
    10000000, destination, 0, 0, 0, 0].map(word).join(''),
});

describe('reachable route modes beyond the historical function list', () => {
  test.each(cases)('$id preserves captured provider quote bytes and checks the final transaction', async (item) => {
    for (const proof of item.providerQuote.proofs) {
      const body = readFileSync(new URL(`../fixtures/route-discovery-20261104/${proof.file}`, import.meta.url));
      expect(createHash('sha256').update(body).digest('hex')).toBe(proof.sha256);
    }
    const check = validateBridgeCalldata(item.aggregatorId, item.chainKey, item.tx, {
      userAddress: item.request.userAddress, fromTokenId: item.request.fromTokenId,
      fromTokenRawAmount: item.request.fromTokenRawAmount, toChainId: item.request.toChainId,
      toTokenId: item.request.toTokenId, toTokenRawAmount: item.quoteBenchmark.quotedOutputAmount,
      slippage: item.request.slippage,
    });
    if (item.expectedUnresolvedFields) {
      expect(check.parsed.unresolvedFields).toEqual(item.expectedUnresolvedFields);
      expect(check.parsed.sourceToken).toBe(item.expected.sourceToken);
      expect(check.parsed.sourceAmount).toBe(BigInt(item.expected.sourceAmount));
      if (item.expectedReceiverVerified) expect(check.parsed.receiver).toBe(item.expected.receiver);
    } else {
      for (const f of ['sourceToken', 'receiver']) expect(check.parsed[f]).toBe(item.expected[f]);
      for (const f of ['sourceAmount', 'destinationChainId']) expect(check.parsed[f]).toBe(BigInt(item.expected[f]));
    }
    if (!item.expectedUnresolvedFields) {
      if (check.parsed.outputToken === undefined) expect(check.parsed.outputTokenReference).toBeDefined();
      else expect(check.parsed.outputToken).toBe(item.expected.outputToken);
      if (check.parsed.minOutputAmount === undefined) expect(check.parsed.outputAmountReference).toBeDefined();
      else expect(check.parsed.minOutputAmount).toBe(BigInt(item.expected.minOutputAmount));
    }
    const params = { ...item.request, bridgeId: item.bridgeId,
      toTokenRawAmount: item.quoteBenchmark.quotedOutputAmount };
    const api = { buildBridgeTx: async () => structuredClone(item.tx) };
    if (item.expectedValidationError) {
      expect(check.ok).toBe(false);
      expect(check.reason).toContain(item.expectedValidationError);
      const reports = [];
      await expect(buildTx(item.aggregatorId, { ...params, onError: (report) => reports.push(report) }, api)).resolves.toBeDefined();
      expect(reports.flatMap((report) => report.errors)).toEqual(expect.arrayContaining([
        expect.objectContaining({ error_code: check.error_code, pass: true, blocking: false }),
      ]));
    } else {
      expect(check.ok).toBe(true);
      expect(check.unverifiedFields).toEqual(check.parsed.unresolvedFields);
      await expect(buildTx(item.aggregatorId, params, api)).resolves.toBeDefined();
    }
  });

  test('[Across] leaves native delivery unresolved without recipient code', () => {
    const parsed = decodeBridgeCalldata('across', native.tx);
    expect(parsed.outputToken).toBeUndefined();
    expect(parsed.outputTokenReference.protocol).toBe('across-native');
    expect(parsed.unresolvedFields).toEqual(['outputToken']);
  });

  test('[LiFi] M0 reads destination fields and rejects a different recipient', () => {
    const extra = [user, user, user, output, 0, 9900000, 2000000000];
    const parsed = decodeBridgeCalldata('lifi', direct('0x65782c4b', extra));
    expect(parsed.sourceToken).toBe(input);
    expect(parsed.sourceAmount).toBe(10000000n);
    expect(parsed.outputToken).toBe(output);
    expect(parsed.minOutputAmount).toBe(9900000n);
    expect(parsed.receiver).toBe(user);
    expect(parsed.unresolvedFields).toEqual([]);
    expect(decodeBridgeCalldata('lifi', direct('0x65782c4b', [1, ...extra.slice(1)]))).toBeNull();
    expect(decodeBridgeCalldata('lifi', direct('0x65782c4b', [user, 1, ...extra.slice(2)]))).toBeNull();
  });

  test('[LiFi] AllBridge and Garden leave uncommitted conditions unresolved', async () => {
    const allbridge = direct('0x6a51e9a9', [user, 100, output, 1, 1, true]);
    const garden = direct('0x5f9af35d', [1, user, 100, 1234, 0]);
    const a = decodeBridgeCalldata('lifi', allbridge), g = decodeBridgeCalldata('lifi', garden);
    expect(a.outputToken).toBe(output);
    expect(a.receiver).toBe(user);
    expect(a.minOutputAmount).toBeUndefined();
    expect(g.receiver).toBeUndefined();
    expect(g.destinationChainId).toBeUndefined();
    expect(g.outputToken).toBeUndefined();
    for (const [bridgeId, tx] of [['allbridge', allbridge], ['garden', garden]]) {
      const params = { userAddress: user, fromChainId: 'eth', toChainId: 'base', fromTokenId: input,
        fromTokenRawAmount: '10000000', toTokenId: output, toTokenRawAmount: '9900000', slippage: '0.01', bridgeId };
      const reports = [];
      await expect(buildTx('lifi', { ...params, onError: (report) => reports.push(report) },
        { buildBridgeTx: async () => tx })).resolves.toBe(tx);
      if (bridgeId === 'allbridge') expect(reports).toEqual([]);
      else expect(reports.flatMap((report) => report.errors)).toEqual(expect.arrayContaining([
        expect.objectContaining({ error_code: 'BRIDGE_UNVERIFIED_BRIDGE_FIELDS', toPass: false, blocking: false }),
      ]));
    }
  });

  test('[LiFi] MegaETH custom depositTo ignores the unused assetIdOnL2', () => {
    const parsed = decodeBridgeCalldata('lifi', direct('0x4213dfff', [output, 200000, true], input, 4326));
    expect(parsed.outputToken).toBeUndefined();
    expect(parsed.unresolvedFields).toContain('outputToken');
  });
});
