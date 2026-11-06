import { asBigint, asRecord, asString, decodeCall, type AbiParam } from '../abi.js';
import { accountFromBytes32 } from '../hex.js';
import { subtractFees } from '../protocols.js';
import type { ParsedBridgeCall } from '../types.js';
import { mayanDestination } from './destination.js';

export const MCTP_BRIDGE_WITH_FEE = '0x2072197f';
export const MCTP_CREATE_ORDER = '0x1c59b7fc';

export const decodeMctpBridge = (data: string, amountFloor?: bigint): Partial<ParsedBridgeCall> => {
  const a = decodeCall([
    { name: 'tokenIn', kind: 'address' }, { name: 'amountIn', kind: 'uint' },
    { name: 'redeemFee', kind: 'uint' }, { name: 'gasDrop', kind: 'uint' },
    { name: 'destAddr', kind: 'bytes', size: 32 }, { name: 'destDomain', kind: 'uint' },
    { name: 'payloadType', kind: 'uint' }, { name: 'customPayload', kind: 'bytes' },
  ], data);
  const destination = mayanDestination('cctp', asBigint(a.destDomain));
  const custom = asString(a.customPayload) !== '0x';
  return {
    protocolMethod: 'bridgeWithFee', ...destination,
    sourceToken: asString(a.tokenIn), sourceAmount: asBigint(a.amountIn),
    bridgeReceiver: accountFromBytes32(asString(a.destAddr)),
    receiver: custom ? undefined : accountFromBytes32(asString(a.destAddr)),
    outputTokenReference: custom ? undefined : { protocol: 'cctp', destinationChainId: destination.destinationChainId },
    minOutputAmount: custom ? undefined : subtractFees(amountFloor ?? asBigint(a.amountIn), asBigint(a.redeemFee)),
    destinationCallData: custom ? asString(a.customPayload) : undefined,
  };
};

const order: AbiParam = { name: 'params', kind: 'tuple', components: [
  { name: 'tokenIn', kind: 'address' }, { name: 'amountIn', kind: 'uint' },
  { name: 'gasDrop', kind: 'uint' }, { name: 'destAddr', kind: 'bytes', size: 32 },
  { name: 'destChain', kind: 'uint' }, { name: 'tokenOut', kind: 'bytes', size: 32 },
  { name: 'minAmountOut', kind: 'uint' }, { name: 'deadline', kind: 'uint' },
  { name: 'redeemFee', kind: 'uint' }, { name: 'referrerAddr', kind: 'bytes', size: 32 },
  { name: 'referrerBps', kind: 'uint' },
] };

export const decodeMctpOrder = (data: string): Partial<ParsedBridgeCall> => {
  const a = asRecord(decodeCall([order], data).params);
  return {
    protocolMethod: 'createOrder', sourceToken: asString(a.tokenIn), sourceAmount: asBigint(a.amountIn),
    ...mayanDestination('wormhole', asBigint(a.destChain), accountFromBytes32(asString(a.tokenOut)), asBigint(a.minAmountOut)),
    receiver: accountFromBytes32(asString(a.destAddr)), referrer: accountFromBytes32(asString(a.referrerAddr)),
  };
};
