import { asBigint, asString, decodeCall } from '../abi.js';
import type { CalldataMethod } from '../abi.js';
import { finishForward } from './forward.js';

export const swapAndForwardEth: CalldataMethod = {
  name: 'swapAndForwardEth',
  selector: '0xfa74fd43',
  decode(data, value) {
    const args = decodeCall(
      [
        { name: 'amountIn', kind: 'uint' },
        { name: 'swapProtocol', kind: 'address' },
        { name: 'swapData', kind: 'bytes' },
        { name: 'middleToken', kind: 'address' },
        { name: 'minMiddleAmount', kind: 'uint' },
        { name: 'mayanProtocol', kind: 'address' },
        { name: 'mayanData', kind: 'bytes' },
      ],
      data
    );
    const amount = asBigint(args.amountIn);
    return finishForward('swapAndForwardEth', asString(args.mayanProtocol), asString(args.mayanData), {
      token: '0x0000000000000000000000000000000000000000',
      amount: amount > 0n ? amount : value,
      protocolAmount: asBigint(args.minMiddleAmount),
    });
  },
};
