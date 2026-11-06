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

const decodePermits = (
  name: string,
  selector: string,
  tail: AbiParam[]
): CalldataMethod => ({
  name,
  selector,
  decode(data, value) {
    const args = decodeCall(
      [
        permits,
        { name: 'tokens', kind: 'array', item: { name: 'token', kind: 'address' } },
        callsParam,
        { name: 'refundTo', kind: 'address' },
        { name: 'nftRecipient', kind: 'address' },
        { name: 'metadata', kind: 'bytes' },
        ...tail,
      ],
      data
    );
    const source = firstPositive(asArray(args.permits));
    const tokens = asArray(args.tokens).map((token) => asString(token));
    return relayCall(name, asString(args.metadata), value, {
      token: tokens[0] ?? source.token,
      amount: source.amount,
    });
  },
});

export const permit3009TransferAndMulticall = decodePermits(
  'permit3009TransferAndMulticall',
  '0xf80f00fb',
  []
);
