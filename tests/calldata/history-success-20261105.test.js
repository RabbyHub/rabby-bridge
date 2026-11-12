import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { validateBridgeCalldata, validateBridgeTx } from '../../dist/index.js';

const records = JSON.parse(readFileSync(join(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/bridge-history-success-20261105.json'
), 'utf8'));

const expectationFor = (record, parsed) => ({
  userAddress: record.userAddress,
  fromTokenId: record.fromTokenId,
  fromTokenRawAmount: parsed?.sourceAmount !== undefined ? parsed.sourceAmount.toString() : '0',
  toChainId: record.toChainId,
  toTokenId: record.toTokenId,
  toTokenRawAmount: parsed?.minOutputAmount !== undefined ? parsed.minOutputAmount.toString() : undefined,
  slippage: record.slippage,
});

const codesOf = (error) => (error?.errors || []).map((item) => item.error_code);

describe('20261105 successful bridge history', () => {
  test('checks each fetched success record with the current calldata validator', () => {
    const codeCounts = {};
    let reported = 0;
    let blocked = 0;
    let clean = 0;

    for (const record of records) {
      const decoded = validateBridgeCalldata(record.aggregatorId, record.chainKey, record.tx);
      const expectation = expectationFor(record, decoded.parsed);

      let result;
      let thrown;
      try {
        result = validateBridgeTx(
          record.aggregatorId,
          record.chainKey,
          record.bridgeId,
          record.tx,
          expectation,
          { allowMissingRelayOrder: true }
        );
      } catch (error) {
        thrown = error;
      }

      const codes = thrown ? codesOf(thrown) : result.errors.map((error) => error.error_code);
      if (thrown) blocked += 1;
      if (codes.length > 0) reported += 1;
      else clean += 1;
      for (const code of codes) codeCounts[code] = (codeCounts[code] || 0) + 1;
    }

    console.log(JSON.stringify({
      fetched: records.length,
      reported,
      blocked,
      clean,
      codeCounts,
    }, null, 2));

    expect(records.length).toBe(977);
    expect(blocked).toBe(reported);
    expect(reported + clean).toBe(records.length);
  });
});
