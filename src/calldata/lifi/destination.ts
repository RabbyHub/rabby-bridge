import { asArray, asBigint, asRecord, asString, decodeCall, type AbiValue } from '../abi.js';
import { accountFromBytes32, readSelector } from '../hex.js';
import { ALLOWANCE_HOLDER, readSettlerSwap } from '../destinationSwap.js';
import { isNative } from '../protocols.js';
import type { ParsedBridgeCall } from '../types.js';

// Base ReceiverOIF constructor binds these two contracts. No RPC or mutable
// caller-supplied identity is used; see evidence/base-lifi-oif-verification.json.
const BASE_OIF = '0xe6ee2a573047598b2452a879f2188b31d0442dbf';
const BASE_EXECUTOR = '0x4dac9d1769b9b304cb04741dcdeb2fc14abdf110';
const BASE_OUTPUT_SETTLER = '0x75220b7600c300005038432a0000f308e0000068';

export const readLifiDestination = (
  parsed: ParsedBridgeCall, data: { [key: string]: AbiValue }
): Partial<ParsedBridgeCall> | undefined => {
  const receiver = accountFromBytes32(asString(data.recipient));
  if (parsed.destinationChainId !== 8453n ||
      accountFromBytes32(asString(data.dstCallReceiver)) !== BASE_OIF ||
      accountFromBytes32(asString(data.outputSettler)) !== BASE_OUTPUT_SETTLER ||
      asString(data.depositAndRefundAddress) !== receiver) return undefined;
  const swaps = asArray(data.dstCallSwapData);
  // No generic call is trusted merely because ReceiverOIF/Executor will forward it.
  if (swaps.length !== 1 || !parsed.outputToken || parsed.minOutputAmount === undefined) return undefined;
  const swap = asRecord(swaps[0]);
  const input = asString(swap.sendingAssetId), amount = asBigint(swap.fromAmount);
  const output = asString(swap.receivingAssetId), callTo = asString(swap.callTo), approval = asString(swap.approveTo);
  if (input !== parsed.outputToken || isNative(input) || amount <= 0n || amount > parsed.minOutputAmount) return undefined;
  const callData = asString(swap.callData);
  if (callTo === input && approval === BASE_EXECUTOR && output === input && readSelector(callData) === '0xa9059cbb') {
    const transfer = decodeCall([{ name: 'to', kind: 'address' }, { name: 'amount', kind: 'uint' }], callData);
    if (asString(transfer.to) !== receiver || asBigint(transfer.amount) !== amount) return undefined;
    // Executor sends any remaining input to the same receiver after this transfer.
    return { receiver, outputToken: input, minOutputAmount: parsed.minOutputAmount };
  }
  if (callTo !== ALLOWANCE_HOLDER || approval !== ALLOWANCE_HOLDER) return undefined;
  const result = readSettlerSwap(callData, parsed.destinationChainId, BASE_EXECUTOR);
  if (!result || result.inputToken !== input || result.inputAmount !== amount || result.outputToken !== output) return undefined;
  return { receiver, outputToken: output, minOutputAmount: result.minOutputAmount };
};
