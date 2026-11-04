import { BRIDGE_ERRORS, asBridgeError } from '../../errors/index.js';
import { innerCallDiagnostics } from '../diagnostics.js';
import { asBigint, asRecord, asString, decodeCall } from '../abi.js';
import type { CalldataMethod } from '../abi.js';
import { subtractFees } from '../protocols.js';
import { bridgeData, fee, input, swapData } from './params.js';
import { readSocketBridge, spliceBridgeAmount } from './protocols/index.js';

export const swapAndBridge: CalldataMethod = {
  name: 'swapAndBridge', selector: '0x324012e2',
  decode(data) {
    const a = decodeCall([{ name: 'quoteId', kind: 'bytes', size: 32 }, { name: 'flags', kind: 'uint' },
      input, fee, swapData, { name: 'swapCallData', kind: 'bytes' }, bridgeData,
      { name: 'bridgeCallData', kind: 'bytes' }], data);
    const source = asRecord(a.input);
    const swap = asRecord(a.swapData);
    const hop = asRecord(a.bridgeData);
    const flags = asBigint(a.flags);
    const amount = subtractFees(asBigint(swap.minOutput), (flags & 1n) !== 0n ? asBigint(asRecord(a.fee).amount) : 0n);
    const value = asBigint(hop.value) + ((flags & 4n) !== 0n ? amount : 0n);
    const token = asString(swap.outputToken);
    const target = asString(hop.target);
    const bridgeCallData = asString(a.bridgeCallData);
    let callData: string;
    try { callData = spliceBridgeAmount(bridgeCallData, flags, amount); }
    catch (error) { throw asBridgeError(error, BRIDGE_ERRORS.CALLDATA_DECODE_FAILED, innerCallDiagnostics(bridgeCallData, 'protocol')); }
    return {
      aggregatorId: 'socket', method: 'swapAndBridge', kind: 'bridge', quoteId: asString(a.quoteId),
      sourceToken: asString(source.inputToken), sourceAmount: asBigint(source.inputAmount), depositor: asString(source.user),
      bridgeToken: token, bridgeAmount: amount,
      referrer: asString(asRecord(a.fee).receiver), innerTarget: target,
      ...readSocketBridge(callData, target, token, value, asString(hop.approvalSpender)),
    };
  },
};
