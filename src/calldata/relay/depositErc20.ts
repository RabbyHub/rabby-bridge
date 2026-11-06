import { asBigint, asString, decodeCall } from '../abi.js';
import type { CalldataMethod } from '../abi.js';

export const depositErc20: CalldataMethod = {
  name: 'depositErc20',
  selector: '0xe8017952',
  decode(data) {
    const args = decodeCall(
      [
        { name: 'depositor', kind: 'address' },
        { name: 'token', kind: 'address' },
        { name: 'amount', kind: 'uint' },
        { name: 'id', kind: 'bytes', size: 32 },
      ],
      data
    );
    return {
      aggregatorId: 'relay',
      method: 'depositErc20',
      kind: 'deposit',
      sourceToken: asString(args.token),
      sourceAmount: asBigint(args.amount),
      orderId: asString(args.id),
      depositor: asString(args.depositor),
    };
  },
};
