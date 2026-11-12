import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { _TypedDataEncoder } from '@ethersproject/hash';
import { decodeBridgeCalldata, validateBridgeCalldata, validateBridgeTx } from '../../dist/index.js';
import { verifyLayerSwapRecord } from './provider-offline.js';
import { relayChains, relayOrder } from '../../dist/providers/relay.js';
import { tokenAddress } from '../../dist/providers/data.js';
import { evmChainId } from '../../dist/calldata/chains.js';

const directory = new URL('../fixtures/providers/history-20261103/', import.meta.url);
const load = (name) => JSON.parse(readFileSync(new URL(name, directory), 'utf8'));
export const providerHistoryResponse = (item) => load(item.providerHistory.responseFile);

// Historical responses prove an association to an already mined transaction;
// they do not recreate the original Socket quote's signing-time tx binding.
export const replayProviderHistory = async (item, raw = providerHistoryResponse(item)) => {
  const parsed = decodeBridgeCalldata(item.aggregatorId, item.tx);
  assert.ok(parsed, 'unsupported source calldata');
  validateBridgeTx(item.aggregatorId, item.chainKey, item.bridgeId, item.tx, {
    userAddress: item.tx.from, fromTokenId: item.expected.sourceToken,
    fromTokenRawAmount: item.expected.sourceAmount, toChainId: item.toChainKey,
    toTokenId: item.expected.outputToken, toTokenRawAmount: item.expected.minOutputAmount, slippage: '0',
  }, { allowMissingRelayOrder: true });
  assert.equal(validateBridgeCalldata(item.aggregatorId, item.chainKey, item.tx).ok, true, 'invalid local source calldata');
  const provider = item.providerHistory.provider;
  if (provider === 'layerswap') {
    const row = raw.data.find((row) => BigInt(row.swap.metadata.sequence_number) === BigInt(parsed.orderId));
    assert.ok(row, 'missing matching LayerSwap order');
    const params = {
      bridgeId: item.bridgeId, userAddress: item.tx.from,
      fromChainId: item.chainKey, toChainId: item.toChainKey,
      fromTokenId: item.expected.sourceToken, fromTokenRawAmount: item.expected.sourceAmount,
      // Replay the captured provider quote; the original user-selected quote may no longer be retained.
      toTokenId: item.expected.outputToken, toTokenRawAmount: item.expected.expectedOutputAmount,
      slippage: String(row.quote.slippage), feeRate: 0.25,
    };
    const checked = verifyLayerSwapRecord(params, item.tx, raw);
    assert.equal(checked.binding, 'provider-record');
    return checked.parsed;
  }
  if (provider === 'socket') {
    assert.equal(raw.success, true);
    const { result } = raw, row = result.quoteDetails.row, request = row.userQuoteParams;
    assert.equal(row.srcTxHash.toLowerCase(), item.txHash.toLowerCase());
    assert.equal(result.origin.txHash.toLowerCase(), item.txHash.toLowerCase());
    assert.equal(row.quoteId, result.quoteId);
    assert.equal(parsed.quoteId, row.quoteId);
    assert.equal(row.bridgeName, item.bridgeId);
    assert.equal(request.userAddress.toLowerCase(), item.tx.from.toLowerCase());
    assert.equal(parsed.depositor, request.userAddress.toLowerCase());
    assert.equal(tokenAddress(parsed.sourceToken, item.chainKey), tokenAddress(request.inputToken, item.chainKey));
    assert.equal(parsed.sourceAmount, BigInt(request.inputAmount));
    assert.equal(BigInt(result.origin.chainId), BigInt(request.originChainId));
    assert.equal(BigInt(result.destination.chainId), BigInt(request.destinationChainId));
    assert.equal(BigInt(request.originChainId), evmChainId(item.chainKey));
    assert.equal(BigInt(request.destinationChainId), evmChainId(item.toChainKey));
    assert.equal(result.destination.receiverAddress.toLowerCase(), request.receiverAddress.toLowerCase());
    if (parsed.orderId) assert.equal(parsed.orderId, row.quoteId);
    if (parsed.destinationChainId !== undefined) assert.equal(parsed.destinationChainId, BigInt(request.destinationChainId));
    if (parsed.outputToken) assert.equal(tokenAddress(parsed.outputToken, item.toChainKey), tokenAddress(request.outputToken, item.toChainKey));
    return { ...parsed, sourceToken: tokenAddress(parsed.sourceToken, item.chainKey),
      outputToken: tokenAddress(request.outputToken, item.toChainKey), minOutputAmount: BigInt(row.minOutputAmount),
      receiver: request.receiverAddress.toLowerCase(), destinationChainId: BigInt(request.destinationChainId), unresolvedFields: [] };
  }
  assert.equal(provider, 'relay');
  const requests = raw.requests.filter((request) => request.data.inTxs.some((tx) => tx.hash.toLowerCase() === item.txHash.toLowerCase()));
  assert.equal(requests.length, 1);
  const request = requests[0];
  const original = request.data.inTxs.find((tx) => tx.hash.toLowerCase() === item.txHash.toLowerCase());
  assert.equal(original.data.to.toLowerCase(), item.tx.to.toLowerCase());
  assert.equal(original.data.from.toLowerCase(), item.tx.from.toLowerCase());
  assert.equal(original.data.data.toLowerCase(), item.tx.data.toLowerCase());
  assert.equal(BigInt(original.data.value), BigInt(item.tx.value));
  assert.equal(BigInt(original.chainId), evmChainId(item.chainKey));
  const metadata = relayChains(load('relay-chains.json'));
  const order = relayOrder(request.orderData, metadata);
  const orderId = _TypedDataEncoder.hashStruct('Order', load('relay-order-types.json'), order).toLowerCase();
  assert.equal(orderId, request.protocol.orderId);
  if (parsed.orderId) assert.equal(parsed.orderId, orderId);
  else assert.equal(request.protocol.deposit.origin.transactionId.toLowerCase(), item.txHash.toLowerCase());
  assert.equal(order.inputs.length, 1);
  assert.equal(order.output.calls.length, 0);
  assert.equal(order.output.payments.length, 1);
  const source = metadata.find((chain) => chain.evmId === BigInt(original.chainId));
  const destination = metadata.find((chain) => chain.protocolId === order.output.chainId);
  assert.ok(source && destination);
  assert.equal(destination.evmId, evmChainId(item.toChainKey));
  assert.equal(order.inputs[0].payment.chainId, source.protocolId);
  const input = request.data.metadata.currencyIn;
  assert.equal(tokenAddress(parsed.sourceToken, item.chainKey), tokenAddress(input.currency.address, item.chainKey));
  assert.equal(parsed.sourceAmount, BigInt(input.amount));
  const payment = order.output.payments[0];
  return { ...parsed, sourceToken: tokenAddress(parsed.sourceToken, item.chainKey),
    outputToken: payment.currency, minOutputAmount: BigInt(payment.minimumAmount), receiver: payment.recipient,
    destinationChainId: destination.evmId, unresolvedFields: [] };
};
