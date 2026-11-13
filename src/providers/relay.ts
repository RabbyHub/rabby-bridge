import { BRIDGE_ERRORS, BridgeError } from '../errors/index.js';
import type { BridgeErrorDefinition } from '../errors/index.js';
import { _TypedDataEncoder } from '@ethersproject/hash';
import { getBridgeRouter } from '../list.js';
import { decodeBridgeCalldataResult } from '../calldata/index.js';
import { asBigint, asString, decodeCall } from '../calldata/abi.js';
import type { ParsedBridgeCall } from '../calldata/types.js';
import { relayFundingRouter } from '../calldata/relay/nestedDeposit.js';
import type { BridgeQuoteListParams, BridgeTx } from '../quote.js';
import { address, array, bytes, chain, object, text, tokenAddress, transaction, uint } from './data.js';

// Relay settlement-sdk 0.0.152 ORDER_EIP712_TYPES. EVM addresses are 20-byte
// dynamic bytes, not bytes32. Unknown order versions/VMs fail closed.
// Deadlines remain part of the order hash; they are not checked against the clock.
const ORDER_TYPES = {
  Order: [
    { name: 'version', type: 'string' }, { name: 'solverChainId', type: 'string' },
    { name: 'solver', type: 'address' }, { name: 'salt', type: 'uint256' },
    { name: 'inputs', type: 'Input[]' }, { name: 'output', type: 'Output' }, { name: 'fees', type: 'Fee[]' },
  ],
  Input: [{ name: 'payment', type: 'InputPayment' }, { name: 'refunds', type: 'InputRefund[]' }],
  InputPayment: [
    { name: 'chainId', type: 'string' }, { name: 'currency', type: 'bytes' },
    { name: 'amount', type: 'uint256' }, { name: 'weight', type: 'uint256' },
  ],
  InputRefund: [
    { name: 'chainId', type: 'string' }, { name: 'recipient', type: 'bytes' }, { name: 'currency', type: 'bytes' },
    { name: 'minimumAmount', type: 'uint256' }, { name: 'deadline', type: 'uint32' }, { name: 'extraData', type: 'bytes' },
  ],
  Output: [
    { name: 'chainId', type: 'string' }, { name: 'payments', type: 'OutputPayment[]' },
    { name: 'deadline', type: 'uint32' }, { name: 'calls', type: 'bytes[]' }, { name: 'extraData', type: 'bytes' },
  ],
  OutputPayment: [
    { name: 'recipient', type: 'bytes' }, { name: 'currency', type: 'bytes' },
    { name: 'minimumAmount', type: 'uint256' }, { name: 'expectedAmount', type: 'uint256' },
  ],
  Fee: [
    { name: 'recipientChainId', type: 'string' }, { name: 'recipient', type: 'bytes' },
    { name: 'currencyChainId', type: 'string' }, { name: 'currency', type: 'bytes' }, { name: 'amount', type: 'uint256' },
  ],
};

export type RelayChain = { evmId: bigint; protocolId: string; depository: string };

// Pin protocol identifiers independently of the service's mutable /chains response.
const RELAY_EVM_CHAIN_IDS: Record<string, bigint> = {
  ethereum: 1n, optimism: 10n, cronos: 25n, bnb: 56n, gnosis: 100n, unichain: 130n,
  polygon: 137n, monad: 143n, sonic: 146n, manta: 169n, xlayer: 196n, boba: 288n,
  zksync: 324n, shape: 360n, worldchain: 480n, flow: 747n, stable: 988n, hyperevm: 999n,
  metis: 1088n, soneium: 1868n, ronin: 2020n, abstract: 2741n, morph: 2818n,
  tempo: 4217n, megaeth: 4326n, robinhood: 4663n, mantle: 5000n, somnia: 5031n,
  arc: 5042n, base: 8453n, plasma: 9745n, apechain: 33139n, mode: 34443n,
  mythos: 42018n, arbitrum: 42161n, celo: 42220n, avalanche: 43114n, zircuit: 48900n,
  ink: 57073n, linea: 59144n, bob: 60808n, berachain: 80094n, doma: 97477n,
  plume: 98866n, scroll: 534352n, gensyn: 685689n, katana: 747474n,
  ethereal: 5064014n, zora: 7777777n,
};

export const relayChains = (value: unknown): RelayChain[] => {
  const result: RelayChain[] = [];
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

export const relayOrder = (raw: unknown, metadata: RelayChain[]) => {
  const o = object(raw);
  if (o.version !== 'v1') throw new BridgeError(BRIDGE_ERRORS.UNSUPPORTED_RELAY_ORDER_VERSION);
  const evm = (id: unknown) => {
    const protocolId = text(id);
    if (!metadata.some((c) => c.protocolId === protocolId)) throw new BridgeError(BRIDGE_ERRORS.UNSUPPORTED_RELAY_VM);
    return protocolId;
  };
  const output = object(o.output);
  return {
    version: o.version,
    solverChainId: evm(o.solverChainId), solver: address(o.solver), salt: uint(o.salt).toString(),
    inputs: array(o.inputs).map((rawInput) => {
      const input = object(rawInput), payment = object(input.payment);
      return {
        payment: { chainId: evm(payment.chainId), currency: address(payment.currency), amount: uint(payment.amount).toString(), weight: uint(payment.weight).toString() },
        refunds: array(input.refunds).map((rawRefund) => {
          const r = object(rawRefund);
          return { chainId: evm(r.chainId), recipient: address(r.recipient), currency: address(r.currency),
            minimumAmount: uint(r.minimumAmount).toString(), deadline: uint(r.deadline, 32).toString(), extraData: bytes(r.extraData) };
        }),
      };
    }),
    output: {
      chainId: evm(output.chainId), deadline: uint(output.deadline, 32).toString(), extraData: bytes(output.extraData),
      calls: array(output.calls).map((call) => bytes(call)),
      payments: array(output.payments).map((rawPayment) => {
        const p = object(rawPayment);
        return { recipient: address(p.recipient), currency: address(p.currency),
          minimumAmount: uint(p.minimumAmount).toString(), expectedAmount: uint(p.expectedAmount).toString() };
      }),
    },
    fees: array(o.fees).map((rawFee) => {
      const f = object(rawFee);
      return { recipientChainId: evm(f.recipientChainId), recipient: address(f.recipient),
        currencyChainId: evm(f.currencyChainId), currency: address(f.currency), amount: uint(f.amount).toString() };
    }),
  };
};

export type ProviderQuoteData = {
  tx: BridgeTx;
  parsed: ParsedBridgeCall;
  expectedAmount: bigint;
  approveAddress: string;
  orderId: string;
  requestId: string;
  minimumQuantum?: bigint;
};

const relayOrderMetadata = (): RelayChain[] => Object.entries(RELAY_EVM_CHAIN_IDS).map(([protocolId, evmId]) => ({
  protocolId, evmId, depository: '0x0000000000000000000000000000000000000000',
}));

/**
 * Runtime verification of backend order_data, with no provider request.
 * On success, populate parsed destination fields for the shared intent comparison.
 * This binds the order's terms and recipients, not intermediate funding or final delivery.
 */
export const verifyRelayOrder = (
  orderData: unknown, parsed: ParsedBridgeCall, fromChainId: string, userAddress: string, target: string
): BridgeErrorDefinition[] => {
  let order: ReturnType<typeof relayOrder>;
  try { order = relayOrder(orderData, relayOrderMetadata()); }
  catch { return [BRIDGE_ERRORS.RELAY_ORDER_HASH_MISMATCH]; }
  const hash = _TypedDataEncoder.hashStruct('Order', ORDER_TYPES, order).toLowerCase();
  const user = userAddress.toLowerCase();
  const errors: BridgeErrorDefinition[] = [];
  if (hash !== parsed.orderId?.toLowerCase()) errors.push(BRIDGE_ERRORS.RELAY_ORDER_HASH_MISMATCH);
  if (order.output.payments.length === 0 || order.output.payments.some((payment) => payment.recipient !== user)) {
    errors.push(BRIDGE_ERRORS.RECEIVER_MISMATCH);
  }
  if (order.inputs.some((input) => input.refunds.some((refund) => refund.recipient !== user))) {
    errors.push(BRIDGE_ERRORS.RELAY_REFUND_RECIPIENT_MISMATCH);
  }
  if (order.output.payments.length !== 1 || order.output.calls.length !== 0) {
    errors.push(BRIDGE_ERRORS.UNSUPPORTED_RELAY_ORDER_SHAPE);
  }
  const direct = ['depositNative', 'depositErc20'].includes(parsed.method);
  if ((direct && target.toLowerCase() !== getBridgeRouter('relay', fromChainId)) ||
      (parsed.bridgeReceiver !== undefined &&
        parsed.bridgeReceiver !== relayFundingRouter(parsed.method, target.toLowerCase()))) {
    errors.push(BRIDGE_ERRORS.RELAY_CANONICAL_DEPOSITORY_MISMATCH);
  }
  if (errors.length === 0) {
    const output = order.output.payments[0];
    Object.assign(parsed, {
      destinationChainId: RELAY_EVM_CHAIN_IDS[order.output.chainId],
      outputToken: output.currency, minOutputAmount: BigInt(output.minimumAmount), receiver: output.recipient,
    });
  }
  return errors;
};

/** Offline fixture reader; its direct-deposit/payment checks are not the runtime buildTx policy. */
export const readRelayQuote = (raw: unknown, params: BridgeQuoteListParams, metadata: RelayChain[]): ProviderQuoteData => {
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
