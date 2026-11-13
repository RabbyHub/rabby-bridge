import { BRIDGE_ERRORS, BridgeError } from '../../errors/index.js';
import { applyAcrossMessage } from '../destination.js';
import { asBigint, asString, decodeCall, type AbiParam } from '../abi.js';
import type { CalldataMethod } from '../abi.js';
import { accountFromBytes32 } from '../hex.js';
import { NATIVE_TOKEN } from '../protocols.js';

const fields: AbiParam[] = [
  { name: 'spokePool', kind: 'address' },
  { name: 'depositor', kind: 'address' },
  { name: 'recipient', kind: 'bytes', size: 32 },
  { name: 'inputToken', kind: 'address' },
  { name: 'inputAmount', kind: 'uint' },
  { name: 'outputToken', kind: 'bytes', size: 32 },
  { name: 'outputAmount', kind: 'uint' },
  { name: 'destinationChainId', kind: 'uint' },
  { name: 'exclusiveRelayer', kind: 'bytes', size: 32 },
  { name: 'quoteTimestamp', kind: 'uint' },
  { name: 'fillDeadline', kind: 'uint' },
  { name: 'exclusivityParameter', kind: 'uint' },
  { name: 'message', kind: 'bytes' },
];

export const depositNative: CalldataMethod = {
  name: 'depositNative',
  selector: '0x609ea081',
  decode(data, value) {
    const args = decodeCall(fields, data);
    const inputAmount = asBigint(args.inputAmount);
    if (inputAmount > 0n && value !== inputAmount) throw new BridgeError(BRIDGE_ERRORS.ACROSS_NATIVE_VALUE_MISMATCH);
    return applyAcrossMessage({
      aggregatorId: 'across',
      method: 'depositNative',
      kind: 'bridge',
      depositor: asString(args.depositor),
      sourceToken: NATIVE_TOKEN,
      sourceAmount: inputAmount > 0n ? inputAmount : value,
      bridgeToken: asString(args.inputToken),
      bridgeAmount: inputAmount > 0n ? inputAmount : value,
      destinationChainId: asBigint(args.destinationChainId),
      receiver: accountFromBytes32(asString(args.recipient)),
      outputToken: accountFromBytes32(asString(args.outputToken)),
      minOutputAmount: asBigint(args.outputAmount),
      spokePool: asString(args.spokePool),
    }, asString(args.message));
  },
};
