import { BRIDGE_ERRORS, BridgeError } from '../../errors/index.js';
import { asArray, asBigint, asRecord, asString, type AbiParam, type AbiValue } from '../abi.js';
import type { ParsedBridgeCall } from '../types.js';

const swapComponents: AbiParam[] = [
  { name: 'callTo', kind: 'address' },
  { name: 'approveTo', kind: 'address' },
  { name: 'sendingAssetId', kind: 'address' },
  { name: 'receivingAssetId', kind: 'address' },
  { name: 'fromAmount', kind: 'uint' },
  { name: 'callData', kind: 'bytes' },
  { name: 'requiresDeposit', kind: 'bool' },
];

export const swapDataArrayParam: AbiParam = {
  name: 'swapData', kind: 'array',
  item: { name: 'swap', kind: 'tuple', components: swapComponents },
};

export const swapDataParam: AbiParam = {
  name: 'swapData', kind: 'tuple', components: swapComponents,
};

export const applyFirstSwap = (parsed: ParsedBridgeCall, raw: AbiValue): void => {
  const swaps = asArray(raw);
  const deposits = swaps.map(asRecord).filter((swap) => swap.requiresDeposit === true);
  const first = deposits[0] ?? swaps[0];
  if (!first) return;
  const swap = asRecord(first);
  parsed.sourceToken = asString(swap.sendingAssetId);
  if (deposits.some((deposit) => asString(deposit.sendingAssetId) !== parsed.sourceToken)) {
    throw new BridgeError(BRIDGE_ERRORS.MULTIPLE_SOURCE_ASSETS_ARE_NOT_SUPPORTED);
  }
  parsed.sourceAmount = deposits.length
    ? deposits.reduce((sum, deposit) => sum + asBigint(deposit.fromAmount), 0n)
    : asBigint(swap.fromAmount);
};
