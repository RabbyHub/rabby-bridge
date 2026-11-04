import { applyAcrossMessage } from '../destination.js';
import { asBigint, asString, decodeCall, type AbiParam } from '../abi.js';
import type { CalldataMethod } from '../abi.js';

const fields: AbiParam[] = [
  { name: 'depositor', kind: 'address' },
  { name: 'recipient', kind: 'address' },
  { name: 'inputToken', kind: 'address' },
  { name: 'outputToken', kind: 'address' },
  { name: 'inputAmount', kind: 'uint' },
  { name: 'outputAmount', kind: 'uint' },
  { name: 'destinationChainId', kind: 'uint' },
  { name: 'exclusiveRelayer', kind: 'address' },
  { name: 'quoteTimestamp', kind: 'uint' },
  { name: 'fillDeadline', kind: 'uint' },
  { name: 'exclusivityParameter', kind: 'uint' },
  { name: 'message', kind: 'bytes' },
];

export const depositV3: CalldataMethod = {
  name: 'depositV3',
  selector: '0x7b939232',
  decode(data) {
    const args = decodeCall(fields, data);
    return applyAcrossMessage({
      aggregatorId: 'across',
      method: 'depositV3',
      kind: 'bridge',
      depositor: asString(args.depositor),
      sourceToken: asString(args.inputToken),
      sourceAmount: asBigint(args.inputAmount),
      destinationChainId: asBigint(args.destinationChainId),
      receiver: asString(args.recipient),
      outputToken: asString(args.outputToken),
      minOutputAmount: asBigint(args.outputAmount),
    }, asString(args.message));
  },
};
