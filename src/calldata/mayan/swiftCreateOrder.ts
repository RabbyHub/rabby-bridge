import { asBigint, asRecord, asString, decodeCall, type AbiParam } from '../abi.js';
import { accountFromBytes32 } from '../hex.js';
import type { ParsedBridgeCall } from '../types.js';
import { mayanDestination } from './destination.js';

const params: AbiParam = {
  name: 'params',
  kind: 'tuple',
  components: [
    { name: 'payloadType', kind: 'uint' },
    { name: 'trader', kind: 'bytes', size: 32 },
    { name: 'destAddr', kind: 'bytes', size: 32 },
    { name: 'destChainId', kind: 'uint' },
    { name: 'referrerAddr', kind: 'bytes', size: 32 },
    { name: 'tokenOut', kind: 'bytes', size: 32 },
    { name: 'minAmountOut', kind: 'uint' },
    { name: 'gasDrop', kind: 'uint' },
    { name: 'cancelFee', kind: 'uint' },
    { name: 'refundFee', kind: 'uint' },
    { name: 'deadline', kind: 'uint' },
    { name: 'referrerBps', kind: 'uint' },
    { name: 'auctionMode', kind: 'uint' },
    { name: 'random', kind: 'bytes', size: 32 },
  ],
};

export const SWIFT_CREATE_ORDER = '0xa3a30834';

export const decodeSwiftCreateOrder = (data: string): Partial<ParsedBridgeCall> => {
  const args = decodeCall(
    [
      { name: 'tokenIn', kind: 'address' },
      { name: 'amountIn', kind: 'uint' },
      params,
      { name: 'customPayload', kind: 'bytes' },
    ],
    data
  );
  const order = asRecord(args.params);
  const customPayload = asString(args.customPayload);
  const destination = mayanDestination('wormhole', asBigint(order.destChainId),
    accountFromBytes32(asString(order.tokenOut)), asBigint(order.minAmountOut));
  if (customPayload !== '0x') {
    delete destination.outputToken;
    delete destination.outputAmountReference;
  }
  return {
    protocolMethod: 'createOrderWithToken',
    sourceToken: asString(args.tokenIn),
    sourceAmount: asBigint(args.amountIn),
    ...destination,
    bridgeReceiver: accountFromBytes32(asString(order.destAddr)),
    receiver: customPayload === '0x' ? accountFromBytes32(asString(order.destAddr)) : undefined,
    destinationCallData: customPayload === '0x' ? undefined : customPayload,
    referrer: accountFromBytes32(asString(order.referrerAddr)),
  };
};
