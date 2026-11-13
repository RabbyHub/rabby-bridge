import { BRIDGE_ERRORS, BridgeError } from '../../../dist/errors/index.js';
import { _TypedDataEncoder } from '@ethersproject/hash';
import { getBridgeRouter } from '../../../dist/list.js';
import { decodeBridgeCalldataResult } from '../../../dist/calldata/index.js';
import { asBigint, asString, decodeCall } from '../../../dist/calldata/abi.js';
import { ORDER_TYPES, RELAY_EVM_CHAIN_IDS, relayOrder } from '../../../dist/providers/relay.js';
import { address, array, bytes, chain, object, text, tokenAddress, transaction, uint } from './data.js';

export const relayChains = (value) => {
  const result = [];
  for (const raw of array(object(value).chains)) {
    const c = object(raw);
    if (c.vmType !== 'evm' || !c.protocol) continue;
    const v2 = object(c.protocol).v2;
    if (!v2) continue;
    const protocol = object(v2);
    const entry = { evmId: uint(c.id), protocolId: text(protocol.chainId), depository: address(protocol.depository) };
    if (!Object.prototype.hasOwnProperty.call(RELAY_EVM_CHAIN_IDS, entry.protocolId)) continue;
    if (RELAY_EVM_CHAIN_IDS[entry.protocolId] !== entry.evmId) throw new BridgeError(BRIDGE_ERRORS.RELAY_PROTOCOL_CHAIN_MISMATCH);
    if (result.some((other) => other.evmId === entry.evmId || other.protocolId === entry.protocolId)) throw new BridgeError(BRIDGE_ERRORS.AMBIGUOUS_RELAY_CHAIN);
    result.push(entry);
  }
  return result;
};

/** Captured quote verification; independent of the runtime buildTx policy. */
export const readRelayQuote = (raw, params, metadata) => {
  const q = object(raw);
  const protocol = object(object(q.protocol).v2);
  const order = relayOrder(protocol.orderData, metadata);
  const orderId = _TypedDataEncoder.hashStruct('Order', ORDER_TYPES, order).toLowerCase();
  if (orderId !== bytes(protocol.orderId, 32)) throw new BridgeError(BRIDGE_ERRORS.RELAY_ORDER_HASH_MISMATCH);
  if (order.inputs.length !== 1 || order.output.payments.length !== 1 || order.output.calls.length !== 0) throw new BridgeError(BRIDGE_ERRORS.UNSUPPORTED_RELAY_ORDER_SHAPE);
  const source = metadata.find((c) => c.evmId === chain(params.fromChainId));
  const destination = metadata.find((c) => c.evmId === chain(params.toChainId));
  if (!source || !destination || order.inputs[0].payment.chainId !== source.protocolId || order.output.chainId !== destination.protocolId) throw new BridgeError(BRIDGE_ERRORS.RELAY_ORDER_CHAIN_MISMATCH);
  if (source.depository !== getBridgeRouter('relay', params.fromChainId)?.toLowerCase()) {
    throw new BridgeError(BRIDGE_ERRORS.RELAY_CANONICAL_DEPOSITORY_MISMATCH);
  }
  for (const refund of order.inputs[0].refunds) {
    if (refund.recipient !== address(params.userAddress)) throw new BridgeError(BRIDGE_ERRORS.RELAY_REFUND_RECIPIENT_MISMATCH);
  }
  const steps = array(q.steps).map(object);
  const deposits = steps.filter((step) => step.id === 'deposit');
  if (deposits.length !== 1 || deposits[0].kind !== 'transaction' || deposits[0].depositAddress) throw new BridgeError(BRIDGE_ERRORS.UNSUPPORTED_RELAY_DEPOSIT);
  const items = array(deposits[0].items);
  if (items.length !== 1) throw new BridgeError(BRIDGE_ERRORS.UNSUPPORTED_RELAY_DEPOSIT_COUNT);
  const tx = transaction(object(items[0]).data, params);
  const decodedResult = decodeBridgeCalldataResult('relay', tx);
  if (!decodedResult.ok) throw new BridgeError(BRIDGE_ERRORS.INVALID_CALLDATA, {}, decodedResult.errors);
  const decoded = decodedResult.parsed;
  if (!decoded || !['depositNative', 'depositErc20'].includes(decoded.method)) throw new BridgeError(BRIDGE_ERRORS.UNSUPPORTED_RELAY_DEPOSIT_METHOD);
  const payment = order.inputs[0].payment;
  const paymentDetails = object(protocol.paymentDetails);
  if (tx.to.toLowerCase() !== source.depository || address(paymentDetails.depository) !== source.depository ||
      paymentDetails.chainId !== source.protocolId || address(paymentDetails.currency) !== payment.currency ||
      uint(paymentDetails.amount) !== uint(payment.amount) ||
      decoded.orderId !== orderId || decoded.depositor !== address(params.userAddress) ||
      decoded.sourceToken !== payment.currency || decoded.sourceAmount !== uint(payment.amount)) throw new BridgeError(BRIDGE_ERRORS.RELAY_SOURCE_PAYMENT_MISMATCH);
  if (payment.currency !== tokenAddress(params.fromTokenId, params.fromChainId) ||
      uint(tx.value) !== (payment.currency === '0x0000000000000000000000000000000000000000' ? uint(payment.amount) : 0n)) throw new BridgeError(BRIDGE_ERRORS.RELAY_SOURCE_VALUE_MISMATCH);
  // Approval steps are never executed from the response. Verify their semantics,
  // then expose only the spender so the host can build its own approval.
  const approvals = steps.filter((step) => step.id === 'approve');
  if (approvals.length > 1) throw new BridgeError(BRIDGE_ERRORS.UNSUPPORTED_RELAY_APPROVAL_COUNT);
  for (const step of steps) {
    if (!['approve', 'deposit'].includes(text(step.id))) throw new BridgeError(BRIDGE_ERRORS.UNSUPPORTED_RELAY_STEP);
  }
  for (const step of approvals) {
    const approvalsItems = array(step.items);
    if (step.kind !== 'transaction' || approvalsItems.length !== 1) throw new BridgeError(BRIDGE_ERRORS.UNSUPPORTED_RELAY_APPROVAL);
    const approval = transaction(object(approvalsItems[0]).data, params);
    if (!approval.data.startsWith('0x095ea7b3') || approval.to !== payment.currency || uint(approval.value) !== 0n) throw new BridgeError(BRIDGE_ERRORS.RELAY_APPROVAL_MISMATCH);
    const args = decodeCall([{ name: 'spender', kind: 'address' }, { name: 'amount', kind: 'uint' }], approval.data);
    if (asString(args.spender) !== source.depository || asBigint(args.amount) !== uint(payment.amount)) throw new BridgeError(BRIDGE_ERRORS.RELAY_APPROVAL_MISMATCH);
  }
  const output = order.output.payments[0];
  return {
    tx, orderId, requestId: bytes(deposits[0].requestId, 32), expectedAmount: uint(output.expectedAmount),
    approveAddress: payment.currency === '0x0000000000000000000000000000000000000000' ? '' : source.depository,
    parsed: { ...decoded, destinationChainId: destination.evmId, outputToken: output.currency,
      minOutputAmount: uint(output.minimumAmount), receiver: output.recipient, unresolvedFields: [] },
  };
};
