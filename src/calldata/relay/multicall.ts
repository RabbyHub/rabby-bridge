import { asString, decodeCall } from '../abi.js';
import type { CalldataMethod } from '../abi.js';
import { callsParam, relayCall } from './calls.js';

export const multicall: CalldataMethod = {
  name: 'multicall',
  selector: '0xcd6e13f7',
  decode(data, value) {
    const args = decodeCall(
      [
        callsParam,
        { name: 'refundTo', kind: 'address' },
        { name: 'nftRecipient', kind: 'address' },
        { name: 'metadata', kind: 'bytes' },
      ],
      data
    );
    return relayCall('multicall', asString(args.metadata), value, args.calls);
  },
};
