import { asString, decodeCall } from '../abi.js';
import type { CalldataMethod } from '../abi.js';
import { finishForward } from './forward.js';

export const forwardEth: CalldataMethod = {
  name: 'forwardEth',
  selector: '0xb0f584ff',
  decode(data, value) {
    const args = decodeCall(
      [
        { name: 'mayanProtocol', kind: 'address' },
        { name: 'protocolData', kind: 'bytes' },
      ],
      data
    );
    return finishForward('forwardEth', asString(args.mayanProtocol), asString(args.protocolData), {
      token: '0x0000000000000000000000000000000000000000',
      amount: value,
    });
  },
};
