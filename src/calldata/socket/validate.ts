import { BRIDGE_ERRORS } from '../../errors/index.js';
import type { BridgeErrorDefinition } from '../../errors/index.js';
import { isZeroWord } from '../hex.js';
import type { ParsedBridgeCall } from '../types.js';

export const socketFailure = (parsed: ParsedBridgeCall, expectedUser?: string): BridgeErrorDefinition | undefined => {
  if (expectedUser && parsed.depositor !== expectedUser.toLowerCase()) return BRIDGE_ERRORS.DEPOSITOR_MISMATCH;
  if (parsed.method === 'exec') {
    return BRIDGE_ERRORS.UNRECOGNIZED_SOCKET_ROUTER_CALLDATA;
  }
  if (!parsed.quoteId || isZeroWord(parsed.quoteId)) {
    return BRIDGE_ERRORS.MISSING_QUOTE_ID;
  }
  if (!parsed.protocolMethod) return BRIDGE_ERRORS.UNRECOGNIZED_SOCKET_BRIDGE_CALLDATA;
  if (parsed.sourceToken === undefined) {
    return BRIDGE_ERRORS.MISSING_SOURCE_TOKEN;
  }
  if ((parsed.sourceAmount ?? 0n) <= 0n) {
    return BRIDGE_ERRORS.MISSING_SOURCE_AMOUNT;
  }
  return undefined;
};
