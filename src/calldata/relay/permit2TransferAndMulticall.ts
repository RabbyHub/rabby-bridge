import { asArray, asRecord, asString, decodeCall, type AbiParam } from '../abi.js';
import type { CalldataMethod } from '../abi.js';
import { callsParam, firstPositive, relayCall } from './calls.js';

const permit: AbiParam = {
  name: 'permit',
  kind: 'tuple',
  components: [
    {
      name: 'permitted',
      kind: 'array',
      item: {
        name: 'tokenPermissions',
        kind: 'tuple',
        components: [
          { name: 'token', kind: 'address' },
          { name: 'amount', kind: 'uint' },
        ],
      },
    },
    { name: 'nonce', kind: 'uint' },
    { name: 'deadline', kind: 'uint' },
  ],
};

export const permit2TransferAndMulticall: CalldataMethod = {
  name: 'permit2TransferAndMulticall',
  selector: '0x0a2b8f36',
  decode(data, value) {
    const args = decodeCall(
      [
        { name: 'user', kind: 'address' },
        permit,
        callsParam,
        { name: 'refundTo', kind: 'address' },
        { name: 'nftRecipient', kind: 'address' },
        { name: 'metadata', kind: 'bytes' },
        { name: 'permitSignature', kind: 'bytes' },
      ],
      data
    );
    const source = firstPositive(asArray(asRecord(args.permit).permitted));
    return {
      ...relayCall('permit2TransferAndMulticall', asString(args.metadata), value, args.calls, source),
      depositor: asString(args.user),
    };
  },
};
