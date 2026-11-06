import { applyAcrossMessage } from '../destination.js';
import { asBigint, asString, decodeCall, type AbiParam } from '../abi.js';
import type { CalldataMethod } from '../abi.js';
import { accountFromBytes32 } from '../hex.js';

const fields: AbiParam[] = [
  { name: 'depositor', kind: 'bytes', size: 32 },
  { name: 'recipient', kind: 'bytes', size: 32 },
  { name: 'inputToken', kind: 'bytes', size: 32 },
  { name: 'outputToken', kind: 'bytes', size: 32 },
  { name: 'inputAmount', kind: 'uint' },
  { name: 'outputAmount', kind: 'uint' },
  { name: 'destinationChainId', kind: 'uint' },
  { name: 'exclusiveRelayer', kind: 'bytes', size: 32 },
  { name: 'fillDeadlineOffset', kind: 'uint' },
  { name: 'exclusivityParameter', kind: 'uint' },
  { name: 'message', kind: 'bytes' },
];

export const depositNow: CalldataMethod = {
  name: 'depositNow',
  selector: '0xea86bd46',
  decode(data) {
    const args = decodeCall(fields, data);
    return applyAcrossMessage({
      aggregatorId: 'across',
      method: 'depositNow',
      kind: 'bridge',
      depositor: accountFromBytes32(asString(args.depositor)),
      sourceToken: accountFromBytes32(asString(args.inputToken)),
      sourceAmount: asBigint(args.inputAmount),
      destinationChainId: asBigint(args.destinationChainId),
      receiver: accountFromBytes32(asString(args.recipient)),
      outputToken: accountFromBytes32(asString(args.outputToken)),
      minOutputAmount: asBigint(args.outputAmount),
    }, asString(args.message));
  },
};
