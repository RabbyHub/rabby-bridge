import { BRIDGE_ERRORS } from '../../errors/index.js';
import type { BridgeErrorDefinition } from '../../errors/index.js';
import { isZeroWord } from '../hex.js';
import type { ParsedBridgeCall } from '../types.js';

export const mayanFailure = (parsed: ParsedBridgeCall): BridgeErrorDefinition | undefined => {
  if (!parsed.protocolMethod) {
    return BRIDGE_ERRORS.UNRECOGNIZED_MAYAN_PROTOCOL_CALLDATA;
  }
  if (parsed.destinationChainId === undefined && !parsed.destinationChainRef) {
    return BRIDGE_ERRORS.MISSING_DESTINATION;
  }
  if (isZeroWord(parsed.receiver ?? parsed.bridgeReceiver)) {
    return BRIDGE_ERRORS.MISSING_RECEIVER;
  }
  if ((parsed.sourceAmount ?? 0n) <= 0n) {
    return BRIDGE_ERRORS.MISSING_SOURCE_AMOUNT;
  }
  if (parsed.protocolMethod !== 'bridge' && parsed.outputToken === undefined && !parsed.outputTokenReference && !parsed.destinationCallData) {
    return BRIDGE_ERRORS.MISSING_OUTPUT_TOKEN;
  }
  return undefined;
};
