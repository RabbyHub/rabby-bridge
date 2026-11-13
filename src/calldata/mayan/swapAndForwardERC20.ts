import { asBigint, asString, decodeCall } from '../abi.js';
import type { CalldataMethod } from '../abi.js';
import { finishForward, permitParams } from './forward.js';

export const swapAndForwardERC20: CalldataMethod = {
  name: 'swapAndForwardERC20',
  selector: '0x30dedc57',
  decode(data) {
    const args = decodeCall(
      [
        { name: 'tokenIn', kind: 'address' },
        { name: 'amountIn', kind: 'uint' },
        permitParams,
        { name: 'swapProtocol', kind: 'address' },
        { name: 'swapData', kind: 'bytes' },
        { name: 'middleToken', kind: 'address' },
        { name: 'minMiddleAmount', kind: 'uint' },
        { name: 'mayanProtocol', kind: 'address' },
        { name: 'mayanData', kind: 'bytes' },
      ],
      data
    );
    return finishForward(
      'swapAndForwardERC20',
      asString(args.mayanProtocol),
      asString(args.mayanData),
      {
        token: asString(args.tokenIn),
        amount: asBigint(args.amountIn),
        protocolAmount: asBigint(args.minMiddleAmount),
      }
    );
  },
};
