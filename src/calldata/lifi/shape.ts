import { BRIDGE_ERRORS } from '../../errors/index.js';
import type { BridgeErrorDefinition } from '../../errors/index.js';
import { isZeroWord } from '../hex.js';
import type { ParsedBridgeCall } from '../types.js';

export const bridgeShape = (parsed: ParsedBridgeCall): BridgeErrorDefinition | undefined => {
  if (isZeroWord(parsed.receiver ?? parsed.bridgeReceiver)) {
    return BRIDGE_ERRORS.MISSING_RECEIVER;
  }
  const hasDestination =
    (parsed.destinationChainId !== undefined && parsed.destinationChainId > 0n) ||
    Boolean(parsed.destinationChainRef);
  if (!hasDestination) {
    return BRIDGE_ERRORS.MISSING_DESTINATION_CHAIN;
  }
  if (parsed.method.startsWith('swapAnd') && (parsed.sourceAmount ?? 0n) <= 0n) {
    return BRIDGE_ERRORS.MISSING_SOURCE_AMOUNT;
  }
  if (parsed.sourceToken === undefined) {
    return BRIDGE_ERRORS.MISSING_SOURCE_TOKEN;
  }
  return undefined;
};

export const swapShape = (parsed: ParsedBridgeCall): BridgeErrorDefinition | undefined => {
  if (!parsed.receiver || isZeroWord(parsed.receiver)) {
    return BRIDGE_ERRORS.MISSING_RECEIVER;
  }
  if (parsed.minOutputAmount === undefined) {
    return BRIDGE_ERRORS.MISSING_MIN_OUTPUT;
  }
  if ((parsed.sourceAmount ?? 0n) <= 0n) {
    return BRIDGE_ERRORS.MISSING_SOURCE_AMOUNT;
  }
  return undefined;
};
