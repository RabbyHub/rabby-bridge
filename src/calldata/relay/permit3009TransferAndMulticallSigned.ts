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
      { name: 'from', kind: 'address' },
      { name: 'value', kind: 'uint' },
      { name: 'validAfter', kind: 'uint' },
      { name: 'validBefore', kind: 'uint' },
      { name: 'v', kind: 'uint' },
      { name: 'r', kind: 'bytes', size: 32 },
      { name: 's', kind: 'bytes', size: 32 },
    ],
  },
};

export const permit3009TransferAndMulticallSigned: CalldataMethod = {
  name: 'permit3009TransferAndMulticallSigned',
  selector: '0x745599f3',
  decode(data, value) {
    const args = decodeCall(
      [
        permits,
        { name: 'tokens', kind: 'array', item: { name: 'token', kind: 'address' } },
        callsParam,
        { name: 'refundTo', kind: 'address' },
        { name: 'nftRecipient', kind: 'address' },
        { name: 'metadata', kind: 'bytes' },
        { name: 'multicallSignatures', kind: 'array', item: { name: 'signature', kind: 'bytes' } },
      ],
      data
    );
    const source = firstPositive(asArray(args.permits));
    const tokens = asArray(args.tokens).map((token) => asString(token));
    return relayCall('permit3009TransferAndMulticallSigned', asString(args.metadata), value, args.calls, {
      token: tokens[0] ?? source.token,
      amount: source.amount,
    });
  },
};
