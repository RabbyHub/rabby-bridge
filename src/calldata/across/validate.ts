import { BRIDGE_ERRORS } from '../../errors/index.js';
import type { BridgeErrorDefinition } from '../../errors/index.js';
import { getBridgeRouter } from '../../list.js';
import { evmChainId } from '../chains.js';
import { isZeroWord } from '../hex.js';
import type { ParsedBridgeCall } from '../types.js';

export const acrossFailure = (parsed: ParsedBridgeCall, chainId: string, expectedDepositor?: string): BridgeErrorDefinition | undefined => {
  if (expectedDepositor && parsed.depositor?.toLowerCase() !== expectedDepositor.toLowerCase()) {
    return BRIDGE_ERRORS.DEPOSITOR_MISMATCH;
  }
  if (parsed.destinationChainId === undefined || parsed.destinationChainId <= 0n) {
    return BRIDGE_ERRORS.MISSING_DESTINATION_CHAIN;
  }
  if (isZeroWord(parsed.receiver ?? parsed.bridgeReceiver)) {
    return BRIDGE_ERRORS.MISSING_RECEIVER;
  }
  if ((parsed.sourceAmount ?? 0n) <= 0n) {
    return BRIDGE_ERRORS.MISSING_SOURCE_AMOUNT;
  }
  if (!parsed.spokePool) {
    return undefined;
  }
  const spoke = parsed.spokePool.toLowerCase();
  // BSC's configured outer router is a periphery, separate from its canonical SpokePool.
  const expectedSpoke = evmChainId(chainId) === 56n
    ? '0x4e8e101924ede233c13e2d8622dc8aed2872d505'
    : getBridgeRouter('across', chainId)?.toLowerCase();
  if (expectedSpoke !== spoke) {
    return BRIDGE_ERRORS.SPOKE_POOL_IS_NOT_IN_THE_ALLOWLIST;
  }
  return undefined;
};
