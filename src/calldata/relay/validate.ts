import { BRIDGE_ERRORS } from '../../errors/index.js';
import type { BridgeErrorDefinition } from '../../errors/index.js';
import { isZeroWord } from '../hex.js';
import type { ParsedBridgeCall } from '../types.js';

const AMOUNT_OPTIONAL = new Set(['depositErc20Allowance', 'multicall']);

export const relayFailure = (parsed: ParsedBridgeCall): BridgeErrorDefinition | undefined => {
  if (isZeroWord(parsed.orderId) && isZeroWord(parsed.requestId)) {
    return BRIDGE_ERRORS.MISSING_RELAY_ORDER_ID;
  }
  if (AMOUNT_OPTIONAL.has(parsed.method)) {
    return undefined;
  }
  if ((parsed.sourceAmount ?? 0n) <= 0n) {
    return BRIDGE_ERRORS.MISSING_SOURCE_AMOUNT;
  }
  if (parsed.sourceToken === undefined) {
    return BRIDGE_ERRORS.MISSING_SOURCE_TOKEN;
  }
  return undefined;
};
