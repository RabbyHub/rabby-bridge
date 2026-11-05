import { asBigint, asRecord, asString, decodeCall, type AbiParam } from '../../abi.js';
import { accountFromBytes32, readSelector } from '../../hex.js';
import { LAYERZERO_CHAINS } from '../../protocols.js';
import type { ParsedBridgeCall } from '../../types.js';

const send: AbiParam = { name: 'send', kind: 'tuple', components: [
  { name: 'dstEid', kind: 'uint' }, { name: 'to', kind: 'bytes', size: 32 },
  { name: 'amountLD', kind: 'uint' }, { name: 'minAmountLD', kind: 'uint' },
  { name: 'extraOptions', kind: 'bytes' }, { name: 'composeMsg', kind: 'bytes' }, { name: 'oftCmd', kind: 'bytes' },
] };

export const readOft = (data: string, target: string, token: string): Partial<ParsedBridgeCall> => {
  const legacy = readSelector(data) === '0x2cdf0b95';
  const a = legacy ? decodeCall([
    { name: 'from', kind: 'address' }, { name: 'dstEid', kind: 'uint' }, { name: 'to', kind: 'bytes', size: 32 },
    { name: 'amountLD', kind: 'uint' }, { name: 'minAmountLD', kind: 'uint' },
    { name: 'callParams', kind: 'tuple', components: [
      { name: 'refundAddress', kind: 'address' }, { name: 'zroPaymentAddress', kind: 'address' }, { name: 'adapterParams', kind: 'bytes' },
    ] },
  ], data) : asRecord(decodeCall([send, { name: 'fee', kind: 'tuple', components: [
    { name: 'nativeFee', kind: 'uint' }, { name: 'lzTokenFee', kind: 'uint' },
  ] }, { name: 'refundAddress', kind: 'address' }], data).send);
  const id = asBigint(a.dstEid);
  const ref = { protocol: 'oft' as const, contract: target, token,
    destinationChainId: LAYERZERO_CHAINS[id.toString()], destinationChainRef: `layerzero:${id}` };
  // Stargate's one-byte bus command changes transport, not the recipient. Compose
  // can execute arbitrary destination code and still needs a dedicated decoder.
  const direct = legacy || (asString(a.composeMsg) === '0x' && ['0x', '0x01'].includes(asString(a.oftCmd)));
  return { protocolMethod: legacy ? 'sendFrom' : 'send', destinationChainId: ref.destinationChainId,
    destinationChainRef: ref.destinationChainRef, bridgeReceiver: accountFromBytes32(asString(a.to)),
    receiver: direct ? accountFromBytes32(asString(a.to)) : undefined,
    outputTokenReference: direct ? ref : undefined,
    outputAmountReference: direct ? { kind: 'decimals', amount: asBigint(a.minAmountLD), token: ref } : undefined,
    destinationCallData: direct ? undefined : asString(a.composeMsg),
  };
};
