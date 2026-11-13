import { describe, expect, test } from '@jest/globals';
import { validateBridgeCalldata, validateBridgeTx } from '../../dist/index.js';
import { readFixture } from '../helpers/fixtures.js';
import { expectCalldataError } from '../helpers/assert-validation-error.js';

const records = readFixture('regressions/history-success.json');
// These mined LI.FI routes encode a different output token and recipient.
const rejectedIds = new Set([
  '6bf4bf7858aa44d2129211339a937b29',
  'f9194e6a98a517b5c5e0e5aa61277ee5',
  '46d50fd05dc8afff190a3c5cfe2d4dbc',
]);

describe('successful bridge history', () => {
  test('retains all 760 records and the three expected rejections', () => {
    expect(records).toHaveLength(760);
    expect(new Set(records.map((record) => record.id)).size).toBe(760);
    expect(records.some((record) => record.aggregatorId === 'relay')).toBe(false);
    expect(records.filter((record) => rejectedIds.has(record.id))).toHaveLength(3);
  });

  test.each(records)('$aggregatorId $id preserves its expected validation outcome', (record) => {
    const decoded = validateBridgeCalldata(record.aggregatorId, record.chainKey, record.tx);
    expect(decoded.ok).toBe(true);
    // Raw user/quote amounts were not captured. Reuse decoded amounts only for
    // replay compatibility; independent amount boundaries are tested in validation.test.js.
    const expectation = {
      userAddress: record.userAddress, fromTokenId: record.fromTokenId,
      fromTokenRawAmount: decoded.parsed.sourceAmount?.toString() ?? '0',
      toChainId: record.toChainId, toTokenId: record.toTokenId,
      toTokenRawAmount: decoded.parsed.minOutputAmount?.toString(), slippage: record.slippage,
    };
    const validate = () => validateBridgeTx(record.aggregatorId, record.chainKey, record.bridgeId, record.tx, expectation);
    if (rejectedIds.has(record.id)) {
      const error = expectCalldataError(validate);
      expect(error.errors.map((item) => item.error_code)).toEqual([
        'BRIDGE_TO_TOKEN_MISMATCH', 'BRIDGE_RECEIVER_MISMATCH',
      ]);
    } else {
      expect(validate()).toMatchObject({ pass: true, routerPass: true, fromPass: true, errors: [] });
    }
  });
});
