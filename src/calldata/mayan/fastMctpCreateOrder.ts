import { asBigint, asRecord, asString, decodeCall, type AbiParam } from '../abi.js';
import { accountFromBytes32 } from '../hex.js';
import type { ParsedBridgeCall } from '../types.js';
import { mayanDestination } from './destination.js';

const orderPayload: AbiParam = {
  name: 'orderPayload',
  kind: 'tuple',
  components: [
    { name: 'payloadType', kind: 'uint' },
    { name: 'destAddr', kind: 'bytes', size: 32 },
    { name: 'tokenOut', kind: 'bytes', size: 32 },
    { name: 'amountOutMin', kind: 'uint' },
    { name: 'gasDrop', kind: 'uint' },
    { name: 'redeemFee', kind: 'uint' },
    { name: 'refundFee', kind: 'uint' },
    { name: 'deadline', kind: 'uint' },
    { name: 'referrerAddr', kind: 'bytes', size: 32 },
    { name: 'referrerBps', kind: 'uint' },
  ],
};

export const FAST_MCTP_CREATE_ORDER = '0x2337e236';

export const decodeFastMctpCreateOrder = (data: string): Partial<ParsedBridgeCall> => {
  const args = decodeCall(
    [
      { name: 'tokenIn', kind: 'address' },
      { name: 'amountIn', kind: 'uint' },
      { name: 'circleMaxFee', kind: 'uint' },
      { name: 'destDomain', kind: 'uint' },
      { name: 'minFinalityThreshold', kind: 'uint' },
      orderPayload,
    ],
    data
  );
  const order = asRecord(args.orderPayload);
  return {
    protocolMethod: 'createOrder',
    sourceToken: asString(args.tokenIn),
    sourceAmount: asBigint(args.amountIn),
    ...mayanDestination('cctp', asBigint(args.destDomain),
      accountFromBytes32(asString(order.tokenOut)), asBigint(order.amountOutMin)),
    receiver: accountFromBytes32(asString(order.destAddr)),
    referrer: accountFromBytes32(asString(order.referrerAddr)),
  };
};
