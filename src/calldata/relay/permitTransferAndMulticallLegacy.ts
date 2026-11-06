import { asArray, asString, decodeCall, type AbiParam } from '../abi.js';
import type { CalldataMethod } from '../abi.js';
import { callsParam, firstPositive, relayCall } from './calls.js';

const permits: AbiParam = {
  name: 'permits',
  kind: 'array',
  item: {
    name: 'permit',
    kind: 'tuple',
    components: [
      { name: 'token', kind: 'address' },
      { name: 'owner', kind: 'address' },
      { name: 'value', kind: 'uint' },
      { name: 'nonce', kind: 'uint' },
      { name: 'deadline', kind: 'uint' },
      { name: 'v', kind: 'uint' },
      { name: 'r', kind: 'bytes', size: 32 },
      { name: 's', kind: 'bytes', size: 32 },
    ],
  },
};

export const permitTransferAndMulticallLegacy: CalldataMethod = {
  name: 'permitTransferAndMulticallLegacy',
  selector: '0xfb68c293',
  decode(data, value) {
    const args = decodeCall(
      [
        permits,
        callsParam,
        { name: 'refundTo', kind: 'address' },
        { name: 'nftRecipient', kind: 'address' },
        { name: 'metadata', kind: 'bytes' },
      ],
      data
    );
    const source = firstPositive(asArray(args.permits));
    return relayCall('permitTransferAndMulticallLegacy', asString(args.metadata), value, source);
  },
};
