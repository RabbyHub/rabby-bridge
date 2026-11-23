import { BRIDGE_ERRORS, BridgeError } from '../../errors/index.js';
import type { BridgeErrorDefinition } from '../../errors/index.js';
import { _TypedDataEncoder } from '@ethersproject/hash';
import { getBridgeRouter } from '../../list.js';
import type { ParsedBridgeCall } from '../types.js';
import { relayDepositRouter } from './nestedDeposit.js';
import { address, array, bytes, object, text, uint } from './orderData.js';

// Relay settlement-sdk 0.0.152 ORDER_EIP712_TYPES. EVM addresses are 20-byte
// dynamic bytes, not bytes32. Unknown order versions/VMs fail closed.
// Deadlines remain part of the order hash; they are not checked against the clock.
export const ORDER_TYPES = {
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

// Pin protocol identifiers independently of the service's mutable /chains response.
export const RELAY_EVM_CHAIN_IDS: Record<string, bigint> = {
  ethereum: 1n, optimism: 10n, cronos: 25n, bnb: 56n, gnosis: 100n, unichain: 130n,
  polygon: 137n, monad: 143n, sonic: 146n, manta: 169n, xlayer: 196n, boba: 288n,
  zksync: 324n, shape: 360n, worldchain: 480n, flow: 747n, stable: 988n, hyperevm: 999n,
  metis: 1088n, soneium: 1868n, ronin: 2020n, abstract: 2741n, morph: 2818n,
  tempo: 4217n, megaeth: 4326n, robinhood: 4663n, mantle: 5000n, somnia: 5031n,
  arc: 5042n, base: 8453n, plasma: 9745n, apechain: 33139n, mode: 34443n,
  mythos: 42018n, arbitrum: 42161n, celo: 42220n, avalanche: 43114n, zircuit: 48900n,
  ink: 57073n, linea: 59144n, bob: 60808n, berachain: 80094n, doma: 97477n,
  plume: 98866n, scroll: 534352n, gensyn: 685689n, katana: 747474n,
  ethereal: 5064014n, zora: 7777777n, elysium: 99901n,
};

// Non-EVM destination chains explicitly supported by Relay v2 deposit orders.
export const RELAY_HYPERCORE_CHAIN_IDS: Record<string, bigint> = {
  hyperliquid: 1337n,
};

// HyperCore USDC uses a 16-byte zero currency identifier in Relay v2 orders.
export const RELAY_HYPERCORE_USDC_CURRENCIES = new Set<string>([
  '0x00000000000000000000000000000000',
]);

const isHyperCoreChain = (protocolId: string): boolean =>
  Object.prototype.hasOwnProperty.call(RELAY_HYPERCORE_CHAIN_IDS, protocolId);

export const relayOrder = (raw: unknown) => {
  const o = object(raw);
  if (o.version !== 'v1') throw new BridgeError(BRIDGE_ERRORS.UNSUPPORTED_RELAY_ORDER_VERSION);
  const evm = (id: unknown) => {
    const protocolId = text(id);
    if (!Object.prototype.hasOwnProperty.call(RELAY_EVM_CHAIN_IDS, protocolId)) throw new BridgeError(BRIDGE_ERRORS.UNSUPPORTED_RELAY_VM);
    return protocolId;
  };
  const output = object(o.output);
  const outputChainId = (() => {
    const protocolId = text(output.chainId);
    if (!Object.prototype.hasOwnProperty.call(RELAY_EVM_CHAIN_IDS, protocolId) && !isHyperCoreChain(protocolId)) {
      throw new BridgeError(BRIDGE_ERRORS.UNSUPPORTED_RELAY_VM);
    }
    return protocolId;
  })();
  const refundChain = (id: unknown) => {
    const protocolId = text(id);
    if (Object.prototype.hasOwnProperty.call(RELAY_EVM_CHAIN_IDS, protocolId)) return protocolId;
    if (isHyperCoreChain(protocolId) && protocolId === outputChainId) return protocolId;
    throw new BridgeError(BRIDGE_ERRORS.UNSUPPORTED_RELAY_VM);
  };
  const currencyForChain = (chainId: string, value: unknown) => {
    if (isHyperCoreChain(chainId)) {
      const currency = bytes(value, 16);
      if (!RELAY_HYPERCORE_USDC_CURRENCIES.has(currency)) throw new BridgeError(BRIDGE_ERRORS.INVALID_ADDRESS);
      return currency;
    }
    return address(value);
  };
  return {
    version: o.version,
    solverChainId: evm(o.solverChainId), solver: address(o.solver), salt: uint(o.salt).toString(),
    inputs: array(o.inputs).map((rawInput) => {
      const input = object(rawInput), payment = object(input.payment);
      return {
        payment: { chainId: evm(payment.chainId), currency: address(payment.currency), amount: uint(payment.amount).toString(), weight: uint(payment.weight).toString() },
        refunds: array(input.refunds).map((rawRefund) => {
          const r = object(rawRefund);
          const chainId = refundChain(r.chainId);
          return { chainId, recipient: address(r.recipient), currency: currencyForChain(chainId, r.currency),
            minimumAmount: uint(r.minimumAmount).toString(), deadline: uint(r.deadline, 32).toString(), extraData: bytes(r.extraData) };
        }),
      };
    }),
    output: {
      chainId: outputChainId, deadline: uint(output.deadline, 32).toString(), extraData: bytes(output.extraData),
      calls: array(output.calls).map((call) => bytes(call)),
      payments: array(output.payments).map((rawPayment) => {
        const p = object(rawPayment);
        return { recipient: address(p.recipient), currency: currencyForChain(outputChainId, p.currency),
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

/**
 * Runtime verification of backend order_data, with no provider request.
 * On success, populate parsed destination fields for the shared intent comparison.
 * This binds the order's terms and recipients, not intermediate funding or final delivery.
 */
export const verifyRelayOrder = (
  orderData: unknown,
  parsed: ParsedBridgeCall,
  fromChainId: string,
  userAddress: string,
  target: string,
  expectedReceiver?: string,
): BridgeErrorDefinition[] => {
  let order: ReturnType<typeof relayOrder>;
  try { order = relayOrder(orderData); }
  catch { return [BRIDGE_ERRORS.RELAY_ORDER_HASH_MISMATCH]; }
  const hash = _TypedDataEncoder.hashStruct('Order', ORDER_TYPES, order).toLowerCase();
  const user = userAddress.toLowerCase();
  const receiver = (expectedReceiver ?? userAddress).toLowerCase();
  const errors: BridgeErrorDefinition[] = [];
  if (hash !== parsed.orderId?.toLowerCase()) errors.push(BRIDGE_ERRORS.RELAY_ORDER_HASH_MISMATCH);
  if (order.output.payments.length === 0 || order.output.payments.some((payment) => payment.recipient !== receiver)) {
    errors.push(BRIDGE_ERRORS.RECEIVER_MISMATCH);
  }
  const outputCurrency = order.output.payments[0]?.currency;
  const invalidRefund = order.inputs.some((input) =>
    input.refunds.some((refund) => {
      if (refund.recipient === user) return false;
      const isDestinationFallback =
        refund.chainId === order.output.chainId &&
        outputCurrency !== undefined &&
        refund.currency === outputCurrency &&
        refund.recipient === receiver;
      return !isDestinationFallback;
    })
  );
  if (invalidRefund) {
    errors.push(BRIDGE_ERRORS.RELAY_REFUND_RECIPIENT_MISMATCH);
  }
  if (order.output.payments.length !== 1 || order.output.calls.length !== 0) {
    errors.push(BRIDGE_ERRORS.UNSUPPORTED_RELAY_ORDER_SHAPE);
  }
  const direct = ['depositNative', 'depositErc20'].includes(parsed.method);
  if ((direct && target.toLowerCase() !== getBridgeRouter('relay', fromChainId)) ||
      (parsed.bridgeReceiver !== undefined &&
        parsed.bridgeReceiver !== relayDepositRouter(parsed.method, target.toLowerCase()))) {
    errors.push(BRIDGE_ERRORS.RELAY_CANONICAL_DEPOSITORY_MISMATCH);
  }
  if (errors.length === 0) {
    const output = order.output.payments[0];
    Object.assign(parsed, {
      destinationChainId:
        RELAY_EVM_CHAIN_IDS[order.output.chainId] ??
        RELAY_HYPERCORE_CHAIN_IDS[order.output.chainId],
      outputToken: output.currency, minOutputAmount: BigInt(output.minimumAmount), receiver: output.recipient,
    });
  }
  return errors;
};
