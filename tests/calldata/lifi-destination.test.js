import { readFileSync } from 'node:fs';
import { describe, expect, jest, test } from '@jest/globals';
import { buildTx, decodeBridgeCalldata, validateBridgeTx } from '../../dist/index.js';
import { expectCalldataError } from '../helpers/assert-validation-error.js';

const capture = JSON.parse(readFileSync(new URL('../fixtures/providers/lifi/destination-mismatches.json', import.meta.url)));
const cases = capture.records;
const polygonUsdc = '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359';

describe('[LI.FI] captured destination mismatches', () => {
  test('covers complete rejected builds across five bridge paths', () => {
    expect(cases).toHaveLength(42);
    expect(new Set(cases.map((record) => record.id)).size).toBe(42);
    expect(cases.reduce((counts, record) => {
      counts[record.bridgeId] = (counts[record.bridgeId] ?? 0) + 1;
      return counts;
    }, {})).toEqual({ polygon: 8, polymerStandard: 8, mayanMCTP: 10, celercircle: 8, celercirclefast: 8 });
    expect(new Set(cases.map((record) => record.expected.method)).size).toBe(8);
  });

  test.each(cases)('$id decodes the independently checked recipient and blocks the original build', async (record) => {
    const { intent, expected } = record;
    const tx = structuredClone(record.buildResponse);
    const parsed = decodeBridgeCalldata('lifi', tx);
    expect(parsed).toMatchObject({ method: expected.method, receiver: expected.receiver, destinationChainId: 137n });
    expect(parsed.receiver).not.toBe(intent.userAddress.toLowerCase());
    expect(parsed.destinationCallData).toBeUndefined();
    if (record.bridgeId === 'polygon') {
      // This mapping is unresolved; receiver rejection must not depend on a token comparison.
      expect(parsed.outputToken).toBeUndefined();
      expect(expected.outputToken).toBeNull();
    } else {
      expect(expected.outputToken).toBe(polygonUsdc);
      expect(parsed.outputTokenReference).toMatchObject({ protocol: 'cctp', destinationChainId: 137n });
      if (record.bridgeId === 'mayanMCTP') expect(parsed.protocolMethod).toBe('bridgeWithFee');
    }
    const onError = jest.fn();
    const api = { buildBridgeTx: jest.fn(async () => tx) };
    let buildError;
    try { await buildTx('lifi', { ...intent, onError }, api); } catch (error) { buildError = error; }
    expect(buildError?.errors.map((error) => error.error_code)).toEqual(expected.errorCodes);
    expect(api.buildBridgeTx).toHaveBeenCalledWith(record.buildRequest);
    expect(onError).toHaveBeenCalledTimes(1);
    const error = expectCalldataError(() => validateBridgeTx('lifi', intent.fromChainId, record.bridgeId, tx, intent));
    expect(error.errors.map((item) => item.error_code)).toEqual(expected.errorCodes);
    expect(error.errors.every((item) => item.routerPass && item.fromPass && !item.receiverPass)).toBe(true);
  });
});
