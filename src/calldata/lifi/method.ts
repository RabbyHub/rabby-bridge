import { decodeCall, type AbiParam, type AbiValue } from '../abi.js';
import type { CalldataMethod } from '../abi.js';
import type { ParsedBridgeCall } from '../types.js';
import { applyBridgeData, applyFirstSwap, bridgeDataParam, swapDataArrayParam } from './params.js';

export const lifiBridgeMethod = (
  name: string,
  selector: string,
  tail: AbiParam[],
  withSwap: boolean,
  fill?: (parsed: ParsedBridgeCall, args: { [key: string]: AbiValue }) => void
): CalldataMethod => ({
  name,
  selector,
  decode(data) {
    const params = [bridgeDataParam, ...(withSwap ? [swapDataArrayParam] : []), ...tail];
    const args = decodeCall(params, data);
    const parsed = applyBridgeData(name, args.bridgeData);
    if (withSwap) {
      applyFirstSwap(parsed, args.swapData);
    }
    fill?.(parsed, args);
    return parsed;
  },
});
