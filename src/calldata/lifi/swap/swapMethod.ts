import { asArray, asBigint, asRecord, asString, decodeCall, type AbiParam } from '../../abi.js';
import type { CalldataMethod } from '../../abi.js';
import type { ParsedBridgeCall } from '../../types.js';
import { applyFirstSwap, swapDataArrayParam, swapDataParam } from '../swapData.js';

const header: AbiParam[] = [
  { name: 'transactionId', kind: 'bytes', size: 32 },
  { name: 'integrator', kind: 'string' },
  { name: 'referrer', kind: 'string' },
  { name: 'receiver', kind: 'address' },
  { name: 'minAmountOut', kind: 'uint' },
];

export const lifiSwapMethod = (
  name: string,
  selector: string,
  multiple: boolean
): CalldataMethod => ({
  name,
  selector,
  decode(data, value) {
    const args = decodeCall([...header, multiple ? swapDataArrayParam : swapDataParam], data);
    const parsed: ParsedBridgeCall = {
      aggregatorId: 'lifi',
      method: name,
      kind: 'swap',
      receiver: asString(args.receiver),
      referrer: asString(args.referrer),
      minOutputAmount: asBigint(args.minAmountOut),
    };
    if (multiple) {
      applyFirstSwap(parsed, args.swapData);
      const swaps = asArray(args.swapData).map(asRecord);
      if (swaps.length) parsed.outputToken = asString(swaps[swaps.length - 1].receivingAssetId);
    } else {
      const swap = asRecord(args.swapData);
      parsed.sourceToken = asString(swap.sendingAssetId);
      parsed.sourceAmount = asBigint(swap.fromAmount);
      parsed.outputToken = asString(swap.receivingAssetId);
    }
    if ((parsed.sourceAmount ?? 0n) === 0n && value > 0n) {
      parsed.sourceAmount = value;
    }
    return parsed;
  },
});
