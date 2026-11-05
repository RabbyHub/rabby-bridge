import { readFileSync } from 'node:fs';
import { describe, expect, test } from '@jest/globals';
import {
  validateBridgeCalldata,
  validateBridgeTx,
} from '../../dist/index.js';
import { verifyLayerSwapRecord } from './provider-offline.js';

const { cases } = JSON.parse(readFileSync(
  new URL('../fixtures/candidate-search-20261104/cases.json', import.meta.url), 'utf8'
));
const tags = { across: 'Across', lifi: 'LiFi', socket: 'Socket' };

// These fixed expectations cover historical parsing, without an original Rabby quote.
describe('nine discovered onchain candidate paths', () => {
  test.each(cases.map((item) => [tags[item.aggregatorId], item.path, item]))(
    '[%s] %s matches available fields and reports deferred output checks', async (_, path, item) => {
      expect(item.receipt.status).toBe('0x1');
      expect(item.receipt.transactionHash).toBe(item.txHash);
      expect(item.tx.data.slice(0, 10)).toBe(item.selector);

      const intent = {
        userAddress: item.expected.receiver,
        fromTokenId: item.expected.sourceToken,
        fromTokenRawAmount: item.expected.sourceAmount,
        toChainId: item.expected.destinationChainId,
        toTokenId: item.expected.outputToken,
        toTokenRawAmount: item.expected.minOutputAmount,
        slippage: '0',
      };
      let parsed;
      if (item.provider) {
        const checked = verifyLayerSwapRecord({
          ...intent,
          fromChainId: item.chainKey,
          bridgeId: item.bridgeId,
          toTokenRawAmount: item.provider.expectedOutputAmount,
          slippage: item.provider.slippage,
        }, item.tx, item.provider.response);
        expect(checked.binding).toBe('provider-record');
        parsed = checked.parsed;
      } else {
        expect(validateBridgeTx(item.aggregatorId, item.chainKey, item.bridgeId, item.tx, intent))
          .toMatchObject({ pass: true, routerPass: true, fromPass: true, receiverPass: true });
        const checked = validateBridgeCalldata(item.aggregatorId, item.chainKey, item.tx, intent);
        expect(checked.ok).toBe(true);
        expect(checked.unverifiedFields).toEqual(checked.parsed.unresolvedFields);
        parsed = checked.parsed;
      }

      expect([parsed.method, parsed.protocolMethod ?? '-'].join(' / ')).toBe(path);
      for (const field of ['sourceToken', 'receiver']) {
        expect(parsed[field]).toBe(item.expected[field]);
      }
      for (const field of ['sourceAmount', 'destinationChainId']) {
        expect(parsed[field]).toBe(BigInt(item.expected[field]));
      }
      if (parsed.outputToken === undefined) expect(parsed.outputTokenReference).toBeDefined();
      else expect(parsed.outputToken).toBe(item.expected.outputToken);
      if (parsed.minOutputAmount === undefined) expect(parsed.outputAmountReference).toBeDefined();
      else expect(parsed.minOutputAmount).toBe(BigInt(item.expected.minOutputAmount));
      expect(parsed.unresolvedFields.every((field) => ['outputToken', 'minOutputAmount'].includes(field))).toBe(true);
    }
  );
});
