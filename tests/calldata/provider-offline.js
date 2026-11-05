import assert from 'node:assert/strict';
import { readLayerSwapDeposit, readLayerSwapOrder, layerSwapSequence } from '../../dist/providers/layerswap.js';
import { assertIntent } from '../../dist/providers/data.js';
import { validateBridgeTx } from '../../dist/index.js';

// Captured order evidence is replayed only in tests. The public SDK has no
// provider client, request adapter, pagination, cache or network fallback.
export const verifyLayerSwapRecord = (params, tx, response) => {
  const deposit = readLayerSwapDeposit(tx, params);
  const local = validateBridgeTx('lifi', params.fromChainId, params.bridgeId, tx, params);
  assert.equal(local.fromPass, true, 'invalid local source fields');
  assert.equal(local.receiverPass, true, 'invalid local receiver');
  const matches = response.data.filter((row) => layerSwapSequence(row) === BigInt(deposit.parsed.orderId));
  assert.equal(matches.length, 1, 'missing or ambiguous LayerSwap order');
  const data = readLayerSwapOrder(matches[0], params, deposit);
  assert.equal(data.expectedAmount, BigInt(params.toTokenRawAmount), 'selected output amount mismatch');
  assertIntent(data.parsed, params, data.expectedAmount, data.minimumQuantum);
  return { provider: 'layerswap', binding: 'provider-record', parsed: data.parsed };
};
