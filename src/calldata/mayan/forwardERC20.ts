import { asBigint, asString, decodeCall } from '../abi.js';
import type { CalldataMethod } from '../abi.js';
import { finishForward, permitParams } from './forward.js';

export const forwardERC20: CalldataMethod = {
  name: 'forwardERC20',
  selector: '0xe4269fc4',
  decode(data) {
    const args = decodeCall(
      [
        { name: 'tokenIn', kind: 'address' },
        { name: 'amountIn', kind: 'uint' },
        permitParams,
        { name: 'mayanProtocol', kind: 'address' },
        { name: 'protocolData', kind: 'bytes' },
      ],
      data
    );
    return finishForward('forwardERC20', asString(args.mayanProtocol), asString(args.protocolData), {
      token: asString(args.tokenIn),
      amount: asBigint(args.amountIn),
    });
  },
};
