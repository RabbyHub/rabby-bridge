import { asString, decodeCall } from '../abi.js';
import type { CalldataMethod } from '../abi.js';

export const depositErc20Allowance: CalldataMethod = {
  name: 'depositErc20Allowance',
  selector: '0x5a1ee3ac',
  decode(data) {
    const args = decodeCall(
      [
        { name: 'depositor', kind: 'address' },
        { name: 'token', kind: 'address' },
        { name: 'id', kind: 'bytes', size: 32 },
      ],
      data
    );
    return {
      aggregatorId: 'relay',
      method: 'depositErc20Allowance',
      kind: 'deposit',
      sourceToken: asString(args.token),
      orderId: asString(args.id),
      depositor: asString(args.depositor),
    };
  },
};
