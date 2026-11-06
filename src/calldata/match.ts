import { BRIDGE_ERRORS, asBridgeError, bridgeFailure } from '../errors/index.js';
import type { CalldataMethod } from './abi.js';
import { readSelector } from './hex.js';
import type { DecodeHit } from './types.js';
import { resolveParsed } from './resolve.js';
import { calldataDiagnostics } from './diagnostics.js';

export const matchMethod = (methods: CalldataMethod[], data: string, value: bigint): DecodeHit => {
  const selector = readSelector(data);
  const diagnostics = calldataDiagnostics(data);
  if (!selector) return bridgeFailure([{ ...(data && data !== '0x' ? BRIDGE_ERRORS.INVALID_SELECTOR : BRIDGE_ERRORS.MISSING_CALLDATA), ...diagnostics }]);
  for (const method of methods) {
    if (method.selector !== selector) continue;
    try {
      return { ok: true, parsed: resolveParsed(method.decode(data, value)) };
    } catch (error) {
      return { ...bridgeFailure(asBridgeError(error, BRIDGE_ERRORS.CALLDATA_DECODE_FAILED,
        { method: method.name, ...diagnostics }).errors), method: method.name };
    }
  }
  return bridgeFailure([{ ...BRIDGE_ERRORS.UNSUPPORTED_METHOD, ...diagnostics }]);
};
