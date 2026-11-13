import { asString, decodeCall } from '../abi.js';
import type { CalldataMethod } from '../abi.js';

export const depositNative: CalldataMethod = {
  name: 'depositNative',
  selector: '0x49290c1c',
  decode(data, value) {
    const args = decodeCall(
      [
        { name: 'depositor', kind: 'address' },
        { name: 'id', kind: 'bytes', size: 32 },
      ],
      data
    );
    return {
      aggregatorId: 'relay',
      method: 'depositNative',
      kind: 'deposit',
      sourceToken: '0x0000000000000000000000000000000000000000',
      sourceAmount: value,
      orderId: asString(args.id),
      depositor: asString(args.depositor),
    };
  },
};
